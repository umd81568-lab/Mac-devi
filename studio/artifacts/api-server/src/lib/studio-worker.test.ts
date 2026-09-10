import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after, beforeEach } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  projectPlansTable,
  projectsTable,
  renderJobsTable,
  studioAssetsTable,
  studioJobsTable,
} from "@workspace/db";
import {
  processQueueOnce,
  readStudioFile,
  recoverInFlightJobs,
  saveAsset,
  studioOutputPath,
  verifyPresenterVideo,
} from "./studio-worker.js";
import { presenterRequirements, queuePresenter, signNonce } from "./bridge.js";

const execFileAsync = promisify(execFile);
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const createdProjectIds: number[] = [];
const createdAssetIds: number[] = [];
const createdStudioJobIds: number[] = [];
const createdRenderJobIds: number[] = [];
const humanPerformanceFixture = fileURLToPath(
  new URL("./fixtures/real-human-performance.mp4", import.meta.url),
);
const humanPerformanceFixtureSha256 =
  "af98d56bb5b4a5d1ae8c7dbb8c3ac00c47cd9e1549f5c0a035258e628396641d";

async function cleanup() {
  if (createdStudioJobIds.length) {
    await db.delete(studioJobsTable).where(inArray(studioJobsTable.id, createdStudioJobIds));
  }
  if (createdRenderJobIds.length) {
    await db.delete(renderJobsTable).where(inArray(renderJobsTable.id, createdRenderJobIds));
  }
  if (createdAssetIds.length) {
    await db.delete(studioAssetsTable).where(inArray(studioAssetsTable.id, createdAssetIds));
  }
  if (createdProjectIds.length) {
    await db.delete(projectPlansTable).where(inArray(projectPlansTable.projectId, createdProjectIds));
    await db.delete(projectsTable).where(inArray(projectsTable.id, createdProjectIds));
  }
  createdProjectIds.length = 0;
  createdAssetIds.length = 0;
  createdStudioJobIds.length = 0;
  createdRenderJobIds.length = 0;
}

beforeEach(cleanup);

after(async () => {
  await cleanup();
  await rm(studioOutputPath(), { recursive: true, force: true });
  await pool.end();
});

async function createProject() {
  const [project] = await db.insert(projectsTable).values({
    name: `Worker regression ${Date.now()}`,
    description: "A short persisted worker fixture.",
    status: "production",
    format: "landscape",
    durationSeconds: 2,
    scenes: 1,
  }).returning();
  createdProjectIds.push(project.id);
  return project;
}

async function outputMetadata(outputPath: string) {
  assert.match(outputPath, /^\/api\/files\/[a-z0-9._-]+$/i);
  const bytes = await readStudioFile(path.basename(outputPath));
  assert.ok(bytes && bytes.length > 0, `expected ${outputPath} to be readable`);
  return bytes;
}

async function withApiServer(
  run: (baseUrl: string) => Promise<void>,
) {
  const { default: app } = await import("../app.js");
  const server: Server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}/api`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

async function jsonRequest(
  baseUrl: string,
  pathname: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Expected JSON from ${pathname}, received: ${text.slice(0, 1200)}`);
  }
  return { response, payload };
}

async function brightSubtitleBandPixels(filePath: string, label: string) {
  const rawPath = path.join(studioOutputPath(), `${label}.gray`);
  await execFileAsync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", "1",
    "-i", filePath,
    "-vf", "crop=iw:ih/3:0:2*ih/3,format=gray",
    "-frames:v", "1",
    "-f", "rawvideo",
    rawPath,
  ]);
  try {
    const pixels = await readFile(rawPath);
    return [...pixels].filter((value) => value > 220).length;
  } finally {
    await rm(rawPath, { force: true });
  }
}

function signedHeaders(workerId: string, secret: string, nonce: string, pathname: string, body?: unknown, method = "POST") {
  return {
    "x-studio-worker-id": workerId,
    "x-studio-nonce": nonce,
    "x-studio-signature": signNonce(secret, nonce, method, pathname, body),
  };
}

test("voice and render jobs complete, while presenter generation fails honestly without the Mac pipeline", async () => {
  const project = await createProject();
  await db.insert(projectPlansTable).values({
    projectId: project.id,
    title: project.name,
    summary: "Worker fixture",
    sceneCount: 1,
    estimatedDurationSeconds: 2,
    scenes: [{
      index: 1,
      title: "Opening",
      narration: "A persisted local render.",
      visualPrompt: "A studio set",
      durationSeconds: 2,
      assetStatus: "ready",
    }],
  });

  const assetPath = await saveAsset(pngBytes, "presenter.png", "image/png", "presenter-reference");
  const [asset] = await db.insert(studioAssetsTable).values({
    kind: "presenter-reference",
    name: "Worker presenter",
    filePath: assetPath,
    mimeType: "image/png",
    sizeBytes: pngBytes.length,
    consentGranted: true,
    consentSubject: "Test subject",
    metadata: { importedLocally: true, referenceType: "real-human" },
  }).returning();
  createdAssetIds.push(asset.id);

  const [voiceJob] = await db.insert(studioJobsTable).values({
    kind: "voice",
    config: { text: "Voice regression", rate: 1, pitch: 0, pauseMs: 0 },
  }).returning();
  createdStudioJobIds.push(voiceJob.id);
  const [presenterJob] = await db.insert(studioJobsTable).values({
    kind: "presenter-lipsync",
    assetId: asset.id,
    config: { script: "Presenter regression" },
  }).returning();
  createdStudioJobIds.push(presenterJob.id);
  const [renderJob] = await db.insert(renderJobsTable).values({
    projectId: project.id,
    preset: "preview",
  }).returning();
  createdRenderJobIds.push(renderJob.id);

  await processQueueOnce();
  const [voiceComplete] = await db.select().from(studioJobsTable).where(eq(studioJobsTable.id, voiceJob.id));
  assert.equal(voiceComplete.status, "complete");
  assert.equal(voiceComplete.progress, 100);
  assert.ok(voiceComplete.completedAt);
  const voiceOutput = await outputMetadata(voiceComplete.outputPath!);
  assert.equal(voiceOutput.subarray(0, 4).toString(), "RIFF");
  assert.equal(voiceOutput.subarray(8, 12).toString(), "WAVE");

  await processQueueOnce();
  const [presenterComplete] = await db.select().from(studioJobsTable).where(eq(studioJobsTable.id, presenterJob.id));
  assert.equal(presenterComplete.status, "failed");
  assert.match(presenterComplete.error ?? "", /presenter pipeline/i);
  assert.equal(presenterComplete.outputPath, null);

  await processQueueOnce();
  const [renderComplete] = await db.select().from(renderJobsTable).where(eq(renderJobsTable.id, renderJob.id));
  assert.equal(renderComplete.status, "complete");
  assert.equal(renderComplete.progress, 100);
  assert.ok(renderComplete.completedAt);
  assert.ok(renderComplete.subtitlePath);
  const renderOutput = await outputMetadata(renderComplete.outputPath!);
  assert.equal(renderOutput.subarray(4, 8).toString(), "ftyp");
  const subtitle = await outputMetadata(renderComplete.subtitlePath!);
  assert.match(subtitle.toString(), /-->/);

  const probe = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path.join(studioOutputPath(), path.basename(renderComplete.outputPath!)),
  ]);
  assert.ok(Number.parseFloat(probe.stdout) > 0);
});

test("rejects a static presenter video even when it has voice audio", async () => {
  const staticPath = path.join(studioOutputPath(), "static-presenter-test.mp4");
  await execFileAsync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:s=320x240:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", staticPath,
  ]);
  await assert.rejects(
    verifyPresenterVideo(staticPath, 2),
    /visually static|motion verification/i,
  );
});

test("signed presenter routes require director review before a candidate becomes complete", async () => {
  const fixture = await readFile(humanPerformanceFixture);
  assert.equal(
    createHash("sha256").update(fixture).digest("hex"),
    humanPerformanceFixtureSha256,
  );
  const fixtureVerification = await verifyPresenterVideo(humanPerformanceFixture, 4);
  assert.equal(fixture.subarray(4, 8).toString(), "ftyp");
  assert.ok(fixtureVerification.durationSeconds >= 3.5);
  assert.equal(fixtureVerification.width, 1280);
  assert.equal(fixtureVerification.height, 720);

  const assetPath = await saveAsset(
    fixture,
    "real-human-performance.mp4",
    "video/mp4",
    "presenter-reference",
  );
  const [asset] = await db.insert(studioAssetsTable).values({
    kind: "presenter-reference",
    name: "Consented human fixture",
    filePath: assetPath,
    mimeType: "video/mp4",
    sizeBytes: fixture.length,
    consentGranted: true,
    consentSubject: "Fixture performer",
    metadata: {
      importedLocally: true,
      referenceType: "real-human",
      sha256: humanPerformanceFixtureSha256,
    },
  }).returning();
  createdAssetIds.push(asset.id);

  const script = "Signed worker fixture subtitle";
  const jobConfig = {
    script,
    framing: "waist-up",
    deliveryMode: "presentational",
    durationSeconds: 4,
    requirements: presenterRequirements,
    generationQueued: true,
    outputMetadata: null,
  };
  const [job, invalidMetadataJob] = await db.insert(studioJobsTable).values([
    {
      kind: "presenter-lipsync",
      assetId: asset.id,
      status: "rendering",
      config: jobConfig,
    },
    {
      kind: "presenter-lipsync",
      assetId: asset.id,
      status: "rendering",
      config: jobConfig,
    },
  ]).returning();
  createdStudioJobIds.push(job.id, invalidMetadataJob.id);

  await withApiServer(async (baseUrl) => {
    const pairing = await jsonRequest(baseUrl, "/system/bridge/pairing");
    assert.equal(pairing.response.status, 201);
    const secret = String(pairing.payload.pairingCode);
    const workerId = `fixture-worker-${Date.now()}`;
    const handshakeNonce = "fixture-handshake-0001";
    const handshakeBody = {
      workerId,
      pairingCode: secret,
      nonce: handshakeNonce,
      signature: "",
      protocolVersion: "1",
      workerVersion: "fixture",
      deviceName: "Fixture Mac",
      chip: "Apple M4",
      memoryGb: 32,
      metal: true,
      mps: true,
      mlx: true,
      diskFreeGb: 100,
      diskTotalGb: 200,
      runtime: "test",
      permissions: { files: true },
      presenterPipeline: true,
      presenterModel: "Fixture human performance model",
      imagePipeline: true,
      imageModel: "Fixture FLUX model",
    };
    handshakeBody.signature = signNonce(secret, handshakeNonce, "POST", "/system/bridge/handshake", handshakeBody);
    const handshake = await jsonRequest(baseUrl, "/system/bridge/handshake", handshakeBody);
    assert.equal(handshake.response.status, 200);
    assert.equal(handshake.payload.imageReady, true);
    assert.equal(handshake.payload.imageModel, "Fixture FLUX model");

    const queuedCommandId = queuePresenter({
      studioJobId: job.id,
      sourceFile: path.basename(assetPath),
      audioFile: "expected-local-audio.wav",
      script,
      presenterMode: "presenter-lipsync",
      framing: "waist-up",
      deliveryMode: "presentational",
      durationSeconds: 4,
      referenceSha256: humanPerformanceFixtureSha256,
      audioSha256: "a".repeat(64),
    });
    const commands = await fetch(`${baseUrl}/system/bridge/commands`, {
      headers: signedHeaders(workerId, secret, "fixture-command-poll", "/system/bridge/commands", undefined, "GET"),
    });
    assert.equal(commands.status, 200);
    const commandsPayload = await commands.json() as Array<Record<string, unknown>>;
    const queuedCommand = commandsPayload.find(({ id }) => id === queuedCommandId);
    assert.deepEqual(
      { referenceSha256: queuedCommand?.referenceSha256, audioSha256: queuedCommand?.audioSha256 },
      { referenceSha256: humanPerformanceFixtureSha256, audioSha256: "a".repeat(64) },
    );
    const protectedReference = await fetch(
      `${baseUrl}/system/bridge/files/${path.basename(assetPath)}`,
      {
        headers: signedHeaders(
          workerId,
          secret,
          "fixture-input-download",
          `/system/bridge/files/${path.basename(assetPath)}`,
          undefined,
          "GET",
        ),
      },
    );
    assert.equal(protectedReference.status, 200);
    assert.deepEqual(Buffer.from(await protectedReference.arrayBuffer()), fixture);
    const acknowledgement = await fetch(`${baseUrl}/system/bridge/commands/nonexistent/ack`, {
      method: "POST",
      headers: signedHeaders(workerId, secret, "fixture-empty-ack-1", "/system/bridge/commands/nonexistent/ack"),
    });
    assert.equal(acknowledgement.status, 204);

    const unsignedEvent = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${job.id}/events`,
      {
        status: "uploading",
        progress: 91,
        message: "Unsigned event",
      },
    );
    assert.equal(unsignedEvent.response.status, 401);
    const [beforeSignedEvent] = await db
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.id, job.id));
    assert.equal(beforeSignedEvent.status, "rendering");
    assert.equal(beforeSignedEvent.outputPath, null);
    assert.equal(
      (beforeSignedEvent.config as Record<string, unknown>).workerMessage,
      undefined,
    );

    const eventNonce = "fixture-event-0000001";
    const event = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${job.id}/events`,
      {
        status: "uploading",
        progress: 92,
        message: "Uploading verified human performance",
      },
      signedHeaders(workerId, secret, eventNonce, `/system/bridge/studio-jobs/${job.id}/events`, {
        status: "uploading", progress: 92, message: "Uploading verified human performance",
      }),
    );
    assert.equal(event.response.status, 200);
    assert.equal(event.payload.status, "rendering");
    assert.equal(event.payload.progress, 92);
    const [afterSignedEvent] = await db
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.id, job.id));

    const replayedEvent = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${job.id}/events`,
      {
        status: "complete",
        progress: 100,
        message: "Replayed event",
      },
      signedHeaders(workerId, secret, eventNonce, `/system/bridge/studio-jobs/${job.id}/events`, {
        status: "complete", progress: 100, message: "Replayed event",
      }),
    );
    assert.equal(replayedEvent.response.status, 401);
    const [afterReplayedEvent] = await db
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.id, job.id));
    assert.equal(afterReplayedEvent.status, "rendering");
    assert.equal(afterReplayedEvent.outputPath, null);
    assert.equal(
      (afterReplayedEvent.config as Record<string, unknown>).workerMessage,
      (afterSignedEvent.config as Record<string, unknown>).workerMessage,
    );

    const tamperedRoute = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${invalidMetadataJob.id}/events`,
      { status: "uploading", progress: 93, message: "Route substitution" },
      signedHeaders(workerId, secret, "fixture-route-00001", `/system/bridge/studio-jobs/${job.id}/events`, {
        status: "uploading", progress: 93, message: "Route substitution",
      }),
    );
    assert.equal(tamperedRoute.response.status, 401);

    const tamperedBody = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${invalidMetadataJob.id}/events`,
      { status: "complete", progress: 100, message: "Body substitution" },
      signedHeaders(workerId, secret, "fixture-body-000002", `/system/bridge/studio-jobs/${invalidMetadataJob.id}/events`, {
        status: "uploading", progress: 93, message: "Body substitution",
      }),
    );
    assert.equal(tamperedBody.response.status, 401);

    const inputProvenance = {
      referenceSha256: humanPerformanceFixtureSha256,
      audioSha256: "a".repeat(64),
      assetId: asset.id,
    };
    for (const target of [job.id, invalidMetadataJob.id]) {
      await db.update(studioJobsTable).set({
        config: { ...jobConfig, inputProvenance },
      }).where(eq(studioJobsTable.id, target));
    }
    const validMetadata = {
      pipeline: presenterRequirements.pipeline,
      model: "Fixture human performance model",
      referenceType: "real-human",
      outputType: "real-human-performance",
      speechSynchronized: true,
      motionVerified: true,
      framing: jobConfig.framing,
      deliveryMode: jobConfig.deliveryMode,
      referenceSha256: inputProvenance.referenceSha256,
      audioSha256: inputProvenance.audioSha256,
      outputSha256: humanPerformanceFixtureSha256,
    };
    const unsignedOutput = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`,
      {
        data: fixture.toString("base64"),
        mimeType: "video/mp4",
        metadata: validMetadata,
      },
    );
    assert.equal(unsignedOutput.response.status, 401);
    const [afterUnsignedOutput] = await db
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.id, invalidMetadataJob.id));
    assert.equal(afterUnsignedOutput.status, "rendering");
    assert.equal(afterUnsignedOutput.outputPath, null);
    assert.equal(
      (afterUnsignedOutput.config as Record<string, unknown>).outputMetadata,
      null,
    );

    const invalid = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`,
      {
        data: fixture.toString("base64"),
        mimeType: "video/mp4",
        metadata: { ...validMetadata, motionVerified: false },
      },
      signedHeaders(workerId, secret, "fixture-invalid-0001", `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`, {
        data: fixture.toString("base64"), mimeType: "video/mp4", metadata: { ...validMetadata, motionVerified: false },
      }),
    );
    assert.equal(invalid.response.status, 400);
    assert.match(String(invalid.payload.error), /provenance/i);

    for (const [label, outputType] of [
      ["cartoon", "cartoon"],
      ["slideshow", "slideshow"],
      ["static photo effect", "static-photo-effect"],
    ]) {
      const nonce = `fixture-${outputType}-0001`;
      const adversarial = await jsonRequest(
        baseUrl,
        `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`,
        {
          data: fixture.toString("base64"),
          mimeType: "video/mp4",
          metadata: { ...validMetadata, outputType },
        },
        signedHeaders(workerId, secret, nonce, `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`, {
          data: fixture.toString("base64"),
          mimeType: "video/mp4",
          metadata: { ...validMetadata, outputType },
        }),
      );
      assert.equal(adversarial.response.status, 400, `expected ${label} candidate to be rejected`);
    }

    const wrongReference = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`,
      {
        data: fixture.toString("base64"),
        mimeType: "video/mp4",
        metadata: { ...validMetadata, referenceSha256: "b".repeat(64) },
      },
      signedHeaders(workerId, secret, "fixture-wrong-ref-01", `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`, {
        data: fixture.toString("base64"),
        mimeType: "video/mp4",
        metadata: { ...validMetadata, referenceSha256: "b".repeat(64) },
      }),
    );
    assert.equal(wrongReference.response.status, 400);

    const wrongAudio = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`,
      {
        data: fixture.toString("base64"),
        mimeType: "video/mp4",
        metadata: { ...validMetadata, audioSha256: "c".repeat(64) },
      },
      signedHeaders(workerId, secret, "fixture-wrong-audio1", `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`, {
        data: fixture.toString("base64"),
        mimeType: "video/mp4",
        metadata: { ...validMetadata, audioSha256: "c".repeat(64) },
      }),
    );
    assert.equal(wrongAudio.response.status, 400);

    const replayedOutput = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`,
      {
        data: fixture.toString("base64"),
        mimeType: "video/mp4",
        metadata: validMetadata,
      },
      signedHeaders(workerId, secret, "fixture-invalid-0001", `/system/bridge/studio-jobs/${invalidMetadataJob.id}/output`, {
        data: fixture.toString("base64"), mimeType: "video/mp4", metadata: validMetadata,
      }),
    );
    assert.equal(replayedOutput.response.status, 401);
    const [afterRejectedOutputs] = await db
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.id, invalidMetadataJob.id));
    assert.equal(afterRejectedOutputs.status, "rendering");
    assert.equal(afterRejectedOutputs.outputPath, null);
    assert.equal(
      (afterRejectedOutputs.config as Record<string, unknown>).outputMetadata,
      null,
    );

    const uploaded = await jsonRequest(
      baseUrl,
      `/system/bridge/studio-jobs/${job.id}/output`,
      {
        data: fixture.toString("base64"),
        mimeType: "video/mp4",
        metadata: validMetadata,
      },
      signedHeaders(workerId, secret, "fixture-output-00001", `/system/bridge/studio-jobs/${job.id}/output`, {
        data: fixture.toString("base64"), mimeType: "video/mp4", metadata: validMetadata,
      }),
    );
    assert.equal(uploaded.response.status, 200, JSON.stringify(uploaded.payload));
    assert.equal(uploaded.payload.status, "review");
    assert.equal(uploaded.payload.progress, 100);
    assert.match(String(uploaded.payload.outputPath), /presenter-captioned/);

    const responseMetadata = uploaded.payload.outputMetadata as Record<string, unknown>;
    assert.equal(responseMetadata.subtitlesEmbedded, true);
    assert.equal(responseMetadata.mimeType, "video/mp4");
    assert.deepEqual(responseMetadata.consent, {
      assetId: asset.id,
      granted: true,
      subject: "Fixture performer",
      referenceType: "real-human",
      referenceName: "Consented human fixture",
      referenceMimeType: "video/mp4",
      referenceSha256: humanPerformanceFixtureSha256,
    });
    assert.deepEqual(responseMetadata.provenance, {
      referenceSha256: humanPerformanceFixtureSha256,
      audioSha256: "a".repeat(64),
      outputSha256: humanPerformanceFixtureSha256,
    });
    const verified = responseMetadata.verified as Record<string, unknown>;
    assert.ok(Number(verified.durationSeconds) >= 3.5);
    assert.equal(verified.width, 1280);
    assert.equal(verified.height, 720);

    const [persisted] = await db
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.id, job.id));
    assert.equal(persisted.status, "review");
    assert.equal(persisted.completedAt, null);
    assert.equal(persisted.error, null);
    assert.deepEqual(
      (persisted.config as Record<string, unknown>).outputMetadata,
      responseMetadata,
    );

    const approved = await jsonRequest(
      baseUrl,
      `/studio-jobs/${job.id}/approve`,
    );
    assert.equal(approved.response.status, 200);
    assert.equal(approved.payload.status, "complete");
    const [approvedJob] = await db
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.id, job.id));
    assert.equal(approvedJob.status, "complete");
    assert.ok(approvedJob.completedAt);

    const outputPath = path.join(
      studioOutputPath(),
      path.basename(persisted.outputPath!),
    );
    const outputVerification = await verifyPresenterVideo(outputPath, 4);
    assert.ok(outputVerification.durationSeconds >= 3.5);
    const [sourceBrightPixels, captionedBrightPixels] = await Promise.all([
      brightSubtitleBandPixels(
        humanPerformanceFixture,
        `presenter-source-${job.id}`,
      ),
      brightSubtitleBandPixels(outputPath, `presenter-captioned-${job.id}`),
    ]);
    assert.ok(
      captionedBrightPixels > sourceBrightPixels + 2_000,
      `expected burned subtitle pixels (${captionedBrightPixels}) to exceed the source (${sourceBrightPixels})`,
    );
    const probe = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type:format=duration",
      "-of", "json",
      outputPath,
    ]);
    const media = JSON.parse(probe.stdout) as {
      streams: Array<{ codec_type: string }>;
      format: { duration: string };
    };
    assert.ok(media.streams.some(({ codec_type }) => codec_type === "video"));
    assert.ok(media.streams.some(({ codec_type }) => codec_type === "audio"));
    assert.ok(Number(media.format.duration) >= 3.5);
  });
});

test("recovery requeues persisted rendering jobs after a worker restart", async () => {
  const project = await createProject();
  const startedAt = new Date(Date.now() - 5_000);
  const [studioJob] = await db.insert(studioJobsTable).values({
    kind: "voice",
    status: "rendering",
    progress: 64,
    eta: "about 4 seconds",
    startedAt,
    config: { text: "Recover me" },
  }).returning();
  createdStudioJobIds.push(studioJob.id);
  const [imageJob] = await db.insert(studioJobsTable).values({
    kind: "image",
    status: "rendering",
    progress: 42,
    eta: "waiting for Mac image worker",
    startedAt,
    config: {
      prompt: "Recover this image",
      generationQueued: true,
      commandId: "lost-after-restart",
      outputMetadata: { stale: true },
    },
  }).returning();
  createdStudioJobIds.push(imageJob.id);
  const [renderJob] = await db.insert(renderJobsTable).values({
    projectId: project.id,
    preset: "preview",
    status: "rendering",
    progress: 72,
    eta: "about 3 seconds",
    startedAt,
  }).returning();
  createdRenderJobIds.push(renderJob.id);

  await recoverInFlightJobs();

  const [recoveredStudio] = await db.select().from(studioJobsTable).where(eq(studioJobsTable.id, studioJob.id));
  const [recoveredImage] = await db.select().from(studioJobsTable).where(eq(studioJobsTable.id, imageJob.id));
  const [recoveredRender] = await db.select().from(renderJobsTable).where(eq(renderJobsTable.id, renderJob.id));
  for (const recovered of [recoveredStudio, recoveredImage, recoveredRender]) {
    assert.equal(recovered.status, "queued");
    assert.equal(recovered.eta, "waiting for worker");
    assert.equal(recovered.startedAt, null);
  }
  assert.deepEqual(recoveredImage.config, {
    prompt: "Recover this image",
    generationQueued: false,
    commandId: null,
    outputMetadata: null,
  });
});