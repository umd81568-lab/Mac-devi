import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  projectPlansTable,
  projectsTable,
  renderJobsTable,
  studioAssetsTable,
  studioJobsTable,
} from "@workspace/db";
import type { StoredScenePlan } from "@workspace/db";
import { logger } from "./logger";
import { imageRequirements, presenterRequirements, queueImage, queuePresenter, readinessReport } from "./bridge";

const execFileAsync = promisify(execFile);
const outputDir = path.resolve(process.env.STUDIO_OUTPUT_DIR ?? path.join(process.cwd(), "data", "studio"));
const assetDir = path.join(outputDir, "assets");
const intervalMs = 500;
let processing = false;
let workerTimer: NodeJS.Timeout | undefined;

type JobConfig = Record<string, unknown>;
type CompiledScene = {
  scene: StoredScenePlan & {
    subtitleStartSeconds: number;
    subtitleEndSeconds: number;
    delivery: {
      voiceProfileId: number | null;
      rate: number;
      pitch: number;
      pauseMs: number;
      pronunciation: string | null;
      presenterAssetId: number | null;
      presenterMode: "none" | "lipsync" | "scene";
      presenterFraming: "close-up" | "waist-up" | "full-body";
      presenterDeliveryMode: "conversational" | "presentational" | "energetic" | "calm";
      subtitlesEnabled: boolean;
    };
  };
  startSeconds: number;
  endSeconds: number;
  subtitleStartSeconds: number;
  subtitleEndSeconds: number;
};

function appendSilence(samples: number[], count: number) {
  for (let index = 0; index < count; index += 1) samples.push(0);
}

function safeExtension(mimeType: string, fallback: string) {
  const extension = mimeType.split("/")[1]?.split("+")[0]?.replace(/[^a-z0-9]/gi, "");
  return extension ? `.${extension}` : fallback;
}

async function ensureDirectories() {
  await mkdir(assetDir, { recursive: true });
}

function pcmWav(text: string, rate = 1, pitch = 0, pauseMs = 80, targetSeconds?: number) {
  const sampleRate = 22050;
  const normalized = text.trim() || "Local studio preview";
  const characters = [...normalized];
  const secondsPerCharacter = Math.max(0.025, Math.min(0.09, 0.046 / Math.max(0.55, rate)));
  const silenceSamples = Math.round((Math.max(0, pauseMs) / 1000) * sampleRate);
  const samples: number[] = [];
  for (const [index, character] of characters.entries()) {
    const code = character.codePointAt(0) ?? 65;
    const frequency = Math.max(120, 175 + (code % 18) * 19 + pitch * 12);
    const count = Math.round(secondsPerCharacter * sampleRate);
    for (let i = 0; i < count; i += 1) {
      const envelope = Math.min(1, i / 500, (count - i) / 800);
      const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.22 * Math.max(0, envelope);
      samples.push(Math.round(value * 32767));
    }
    if (/[,.!?;:]/.test(character) || index === characters.length - 1) {
      appendSilence(samples, silenceSamples);
    }
  }
  if (targetSeconds && samples.length < targetSeconds * sampleRate) {
    appendSilence(samples, Math.round(targetSeconds * sampleRate) - samples.length);
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function writeSpeech(text: string, config: JobConfig, filename: string, targetSeconds?: number) {
  const filePath = path.join(outputDir, filename);
  const spokenText = String(config.text ?? text).trim();
  if (process.env.NODE_ENV === "test") {
    await writeFile(
      filePath,
      pcmWav(
        spokenText,
        Number(config.rate ?? 1),
        Number(config.pitch ?? 0),
        Number(config.pauseMs ?? 80),
        targetSeconds,
      ),
    );
    return filePath;
  }
  if (process.platform !== "darwin") {
    throw new Error("Local speech synthesis requires the signed Mac worker or the macOS `say` runtime.");
  }
  const aiffPath = `${filePath}.aiff`;
  const wordsPerMinute = Math.round(175 * Math.max(0.5, Math.min(2, Number(config.rate ?? 1))));
  try {
    await execFileAsync("/usr/bin/say", [
      "--rate",
      String(wordsPerMinute),
      "--output-file",
      aiffPath,
      spokenText,
    ]);
    await runFfmpeg([
      "-i", aiffPath,
      "-ar", "22050",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      filePath,
    ]);
  } finally {
    await unlink(aiffPath).catch(() => undefined);
  }
  return filePath;
}

async function combineWavFiles(paths: string[], filename: string) {
  const buffers = await Promise.all(paths.map((filePath) => readFile(filePath)));
  if (!buffers.length) {
    throw new Error("No scene audio was generated");
  }
  const data = Buffer.concat(buffers.map((buffer) => buffer.subarray(44)));
  const header = Buffer.from(buffers[0].subarray(0, 44));
  header.writeUInt32LE(36 + data.length, 4);
  header.writeUInt32LE(data.length, 40);
  const filePath = path.join(outputDir, filename);
  await writeFile(filePath, Buffer.concat([header, data]));
  return filePath;
}

function normalizeScene(scene: StoredScenePlan) {
  const durationSeconds = Math.max(1, Math.min(120, Number(scene.durationSeconds) || 4));
  const delivery = {
    voiceProfileId: scene.delivery?.voiceProfileId ?? null,
    rate: Math.max(0.5, Math.min(2, Number(scene.delivery?.rate ?? 1))),
    pitch: Math.max(-8, Math.min(8, Number(scene.delivery?.pitch ?? 0))),
    pauseMs: Math.max(0, Math.min(1000, Number(scene.delivery?.pauseMs ?? 120))),
    pronunciation: scene.delivery?.pronunciation ?? null,
    presenterAssetId: scene.delivery?.presenterAssetId ?? null,
    presenterMode: scene.delivery?.presenterMode ?? "none",
    presenterFraming: scene.delivery?.presenterFraming ?? "full-body",
    presenterDeliveryMode: scene.delivery?.presenterDeliveryMode ?? "presentational",
    subtitlesEnabled: scene.delivery?.subtitlesEnabled ?? true,
  };
  const subtitleStartSeconds = Math.max(
    0,
    Math.min(durationSeconds - 0.1, Number(scene.subtitleStartSeconds ?? 0)),
  );
  const subtitleEndSeconds = Math.min(
    durationSeconds,
    Math.max(
      subtitleStartSeconds + 0.1,
      Number(scene.subtitleEndSeconds ?? durationSeconds),
    ),
  );
  return {
    ...scene,
    durationSeconds,
    subtitleStartSeconds,
    subtitleEndSeconds,
    delivery,
  };
}

function compileTimeline(scenes: StoredScenePlan[]): CompiledScene[] {
  let clock = 0;
  return scenes.map((rawScene) => {
    const scene = normalizeScene(rawScene);
    const startSeconds = clock;
    const endSeconds = startSeconds + scene.durationSeconds;
    clock = endSeconds;
    return {
      scene,
      startSeconds,
      endSeconds,
      subtitleStartSeconds: startSeconds + scene.subtitleStartSeconds,
      subtitleEndSeconds: startSeconds + scene.subtitleEndSeconds,
    };
  });
}

function outputName(kind: string, id: number, extension: string) {
  return `${kind}-${id}-${Date.now()}${extension}`;
}

async function isStudioCancelled(id: number) {
  const [job] = await db
    .select({ status: studioJobsTable.status })
    .from(studioJobsTable)
    .where(eq(studioJobsTable.id, id))
    .limit(1);
  return job?.status === "cancelled";
}

async function isRenderCancelled(id: number) {
  const [job] = await db
    .select({ status: renderJobsTable.status })
    .from(renderJobsTable)
    .where(eq(renderJobsTable.id, id))
    .limit(1);
  return job?.status === "cancelled";
}

async function updateStudioProgress(id: number, progress: number, eta: string | null) {
  if (!(await isStudioCancelled(id))) {
    await db.update(studioJobsTable).set({ progress, eta }).where(eq(studioJobsTable.id, id));
  }
}

async function updateRenderProgress(id: number, progress: number, eta: string | null) {
  if (!(await isRenderCancelled(id))) {
    await db.update(renderJobsTable).set({ progress, eta }).where(eq(renderJobsTable.id, id));
  }
}

async function runFfmpeg(args: string[]) {
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    timeout: 180_000,
  });
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPresenterJob(jobId: number, expectedDurationSeconds: number) {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const [job] = await db.select().from(studioJobsTable).where(eq(studioJobsTable.id, jobId)).limit(1);
    if (!job) throw new Error(`Presenter scene job ${jobId} disappeared`);
    if (job.status === "complete" && job.outputPath) {
      const outputPath = path.join(outputDir, path.basename(job.outputPath));
      await verifyPresenterVideo(outputPath, expectedDurationSeconds);
      return outputPath;
    }
    if (job.status === "failed") throw new Error(job.error ?? `Presenter scene job ${jobId} failed`);
    if (job.status === "cancelled") throw new Error(`Presenter scene job ${jobId} was cancelled`);
    await sleep(500);
  }
  throw new Error("Presenter generation timed out waiting for the signed Mac worker.");
}

async function queuePresenterScene(
  renderJobId: number,
  projectId: number,
  scene: CompiledScene,
  audioPath: string,
) {
  const assetId = scene.scene.delivery.presenterAssetId;
  if (!assetId) throw new Error(`Scene ${scene.scene.index} requires a consented presenter reference`);
  const [asset] = await db
    .select()
    .from(studioAssetsTable)
    .where(and(eq(studioAssetsTable.id, assetId), eq(studioAssetsTable.kind, "presenter-reference"), eq(studioAssetsTable.consentGranted, true)))
    .limit(1);
  if (!asset || asset.metadata?.referenceType !== "real-human") {
    throw new Error(`Scene ${scene.scene.index} presenter reference must be a consented real-human asset`);
  }
  const readiness = readinessReport();
  if (!readiness.presenterReady) {
    throw new Error(readiness.presenterBlockReason ?? "Presenter generation is blocked: the local human presenter pipeline is unavailable.");
  }
  const requirements = {
    ...presenterOutputContract,
    renderJobId,
    sceneIndex: scene.scene.index,
  };
  const referenceSha256 = createHash("sha256").update(await readFile(asset.filePath)).digest("hex");
  const audioSha256 = createHash("sha256").update(await readFile(audioPath)).digest("hex");
  const [studioJob] = await db.insert(studioJobsTable).values({
    kind: scene.scene.delivery.presenterMode === "scene" ? "presenter-scene" : "presenter-lipsync",
    projectId,
    assetId,
    status: "rendering",
    progress: 5,
    eta: "waiting for Mac presenter worker",
    config: {
      script: scene.scene.narration,
      framing: scene.scene.delivery.presenterFraming,
      deliveryMode: scene.scene.delivery.presenterDeliveryMode,
      durationSeconds: scene.scene.durationSeconds,
      requirements,
      outputMetadata: null,
      inputProvenance: { referenceSha256, audioSha256, assetId: asset.id },
    },
  }).returning();
  const commandId = queuePresenter({
    studioJobId: studioJob.id,
    sourceFile: path.basename(asset.filePath),
    audioFile: path.basename(audioPath),
    script: scene.scene.narration,
    presenterMode: scene.scene.delivery.presenterMode === "scene" ? "presenter-scene" : "presenter-lipsync",
    framing: scene.scene.delivery.presenterFraming,
    deliveryMode: scene.scene.delivery.presenterDeliveryMode,
    durationSeconds: scene.scene.durationSeconds,
    referenceSha256,
    audioSha256,
  });
  await db.update(studioJobsTable).set({
    config: {
      ...(studioJob.config ?? {}),
      generationQueued: true,
      commandId,
    },
  }).where(eq(studioJobsTable.id, studioJob.id));
  return waitForPresenterJob(studioJob.id, scene.scene.durationSeconds);
}

async function sceneSubtitleFile(jobId: number, scene: CompiledScene, suffix: string) {
  const subtitlePath = path.join(outputDir, outputName(`scene-${suffix}`, jobId, ".srt"));
  await writeFile(
    subtitlePath,
    `${scene.scene.subtitleStartSeconds === undefined ? 0 : 1}\n${subtitleTime(scene.scene.subtitleStartSeconds)} --> ${subtitleTime(scene.scene.subtitleEndSeconds)}\n${scene.scene.narration.trim()}\n`,
  );
  return subtitlePath;
}

async function composePresenterScene(
  jobId: number,
  scene: CompiledScene,
  presenterPath: string,
  audioPath: string,
  size: string,
  index: number,
) {
  const segmentPath = path.join(outputDir, outputName(`render-presenter-scene-${index}`, jobId, ".mp4"));
  const subtitlePath = scene.scene.delivery.subtitlesEnabled
    ? await sceneSubtitleFile(jobId, scene, `render-${index}`)
    : null;
  const subtitleFilter = subtitlePath
    ? `,subtitles=${subtitlePath}:force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'`
    : "";
  await runFfmpeg([
    "-i", presenterPath,
    "-i", audioPath,
    "-t", String(scene.scene.durationSeconds),
    "-vf", `scale=${size}:force_original_aspect_ratio=decrease,pad=${size.replace("x", ":")}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    segmentPath,
  ]);
  return segmentPath;
}

async function concatVideoSegments(jobId: number, segments: string[], size: string, duration: number) {
  const listPath = path.join(outputDir, outputName("render-segments", jobId, ".txt"));
  const outputPath = path.join(outputDir, outputName("render-presenter", jobId, ".mp4"));
  await writeFile(listPath, segments.map((segment) => `file '${segment.replace(/'/g, "'\\''")}'`).join("\n"));
  await runFfmpeg([
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-t", String(duration),
    "-vf", `scale=${size}`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    outputPath,
  ]);
  return outputPath;
}

export const presenterOutputContract = {
  ...presenterRequirements,
  input: "Consented real-human image or video reference plus local voice track",
  motion: "Speech-synchronized mouth and natural head, face, shoulders, torso, and full-body delivery when framed",
  subtitles: "Timed subtitles are burned into previews and scene renders",
  reject: "Cartoon, anime, mascot, illustrated, avatar-style, still-image, or audio-only output",
} as const;

type PresenterMetadata = {
  pipeline: string;
  model: string;
  referenceType: "real-human";
  speechSynchronized: boolean;
  motionVerified: boolean;
  framing: "close-up" | "waist-up" | "full-body";
  deliveryMode: "conversational" | "presentational" | "energetic" | "calm";
};

function presenterJobConfig(config: JobConfig, kind: "presenter-lipsync" | "presenter-scene") {
  return {
    script: String(config.script ?? config.text ?? ""),
    presenterMode: kind,
    framing: (config.framing ?? (kind === "presenter-scene" ? "full-body" : "close-up")) as PresenterMetadata["framing"],
    deliveryMode: (config.deliveryMode ?? "presentational") as PresenterMetadata["deliveryMode"],
    durationSeconds: Math.max(1, Math.min(120, Number(config.durationSeconds ?? 20))),
  };
}

export async function verifyPresenterVideo(filePath: string, expectedDurationSeconds: number) {
  let probe: { streams?: Array<{ codec_type?: string; duration?: string; width?: number; height?: number }>; format?: { duration?: string } };
  try {
    const result = await execFileAsync("ffprobe", [
      "-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath,
    ]);
    probe = JSON.parse(String(result.stdout)) as typeof probe;
  } catch {
    throw new Error("The Mac worker returned a file that is not a readable MP4 video.");
  }
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe.format?.duration ?? video?.duration ?? 0);
  if (!video || !video.width || !video.height || !audio || duration < Math.max(1, expectedDurationSeconds - 0.5)) {
    throw new Error("Presenter output must be an MP4 with video, voice audio, and the requested duration.");
  }
  try {
    const motionProbe = await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "info", "-i", filePath,
      "-vf", "select='gt(scene,0.001)',showinfo", "-an", "-f", "null", "-",
    ], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    const output = `${String(motionProbe.stdout)}${String(motionProbe.stderr)}`;
    if ((output.match(/showinfo.*n:\s*\d+/g) ?? []).length < 2) {
      throw new Error("Presenter output is visually static; a moving human performance is required.");
    }
  } catch (error) {
    if (error instanceof Error && /visually static/.test(error.message)) throw error;
    throw new Error("Presenter motion verification could not confirm non-static human movement.");
  }
  return { durationSeconds: duration, width: video.width, height: video.height };
}

export async function savePresenterOutput(data: Buffer, jobId: number) {
  await ensureDirectories();
  const filePath = path.join(outputDir, outputName("presenter-output", jobId, ".mp4"));
  await writeFile(filePath, data);
  return filePath;
}

export async function saveImageOutput(data: Buffer, jobId: number) {
  await ensureDirectories();
  const filePath = path.join(outputDir, outputName("generated-image", jobId, ".png"));
  await writeFile(filePath, data);
  return filePath;
}

export async function burnPresenterSubtitles(
  filePath: string,
  jobId: number,
  script: string,
  durationSeconds: number,
) {
  const subtitlePath = path.join(outputDir, outputName("presenter-subtitles", jobId, ".srt"));
  const captionedPath = path.join(outputDir, outputName("presenter-captioned", jobId, ".mp4"));
  await writeFile(subtitlePath, `1\n00:00:00,000 --> ${subtitleTime(durationSeconds)}\n${script.trim()}\n`);
  await runFfmpeg([
    "-i", filePath,
    "-vf", `subtitles=${subtitlePath}:force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    captionedPath,
  ]);
  return captionedPath;
}

async function processStudioJob(job: typeof studioJobsTable.$inferSelect) {
  try {
    const config = (job.config ?? {}) as JobConfig;
    if (job.kind === "image") {
      if (config.generationQueued === true) {
        await updateStudioProgress(job.id, 42, "waiting for Mac image worker");
        return;
      }
      const readiness = readinessReport();
      if (!readiness.imageReady) {
        throw new Error(readiness.imageBlockReason ?? "Image generation is blocked: the local FLUX/MLX image pipeline is unavailable.");
      }
      const commandId = queueImage({
        studioJobId: job.id,
        prompt: String(config.prompt ?? ""),
        negativePrompt: String(config.negativePrompt ?? ""),
        width: Number(config.width),
        height: Number(config.height),
        steps: Number(config.steps),
        guidance: Number(config.guidance),
        seed: Number(config.seed),
      });
      await db.update(studioJobsTable).set({
        config: {
          ...config,
          generationQueued: true,
          commandId,
          requirements: imageRequirements,
        },
        status: "rendering",
        progress: 12,
        eta: "waiting for Mac image worker",
        error: null,
      }).where(eq(studioJobsTable.id, job.id));
      return;
    }
    await updateStudioProgress(job.id, 18, "about 10 seconds");
    const text = String(config.text ?? config.script ?? "Local studio preview");
    const audioPath = await writeSpeech(text, config, outputName("voice", job.id, ".wav"), 20);
    await updateStudioProgress(job.id, 48, "about 6 seconds");
    if (await isStudioCancelled(job.id)) return;

    if (job.kind === "voice") {
      await db.update(studioJobsTable).set({
        status: "complete",
        progress: 100,
        eta: null,
        outputPath: `/api/files/${path.basename(audioPath)}`,
        error: null,
        completedAt: new Date(),
      }).where(eq(studioJobsTable.id, job.id));
      return;
    }

    if (!job.assetId) throw new Error("Presenter reference is missing");
    const [asset] = await db.select().from(studioAssetsTable).where(eq(studioAssetsTable.id, job.assetId)).limit(1);
    if (!asset) throw new Error("Presenter reference no longer exists");
    if (asset.kind !== "presenter-reference" || asset.consentGranted !== true || asset.metadata?.referenceType !== "real-human") {
      throw new Error("Presenter reference must be a consented real-human asset; avatar and illustrated references are not accepted.");
    }
    if (job.kind !== "presenter-lipsync" && job.kind !== "presenter-scene") {
      throw new Error(`Unsupported studio job kind: ${job.kind}`);
    }
    const presenter = presenterJobConfig(config, job.kind);
    if (config.generationQueued === true) {
      await updateStudioProgress(job.id, 62, "waiting for generated human performance");
      return;
    }
    const readiness = readinessReport();
    if (!readiness.presenterReady) {
      throw new Error(readiness.presenterBlockReason ?? "Presenter generation is blocked: the local human presenter pipeline is unavailable.");
    }
    const inputProvenance = {
      referenceSha256: createHash("sha256").update(await readFile(asset.filePath)).digest("hex"),
      audioSha256: createHash("sha256").update(await readFile(audioPath)).digest("hex"),
      assetId: asset.id,
    };
    const commandId = queuePresenter({
      studioJobId: job.id,
      sourceFile: path.basename(asset.filePath),
      audioFile: path.basename(audioPath),
      script: presenter.script,
      presenterMode: job.kind,
      framing: presenter.framing,
      deliveryMode: presenter.deliveryMode,
      durationSeconds: presenter.durationSeconds,
      referenceSha256: inputProvenance.referenceSha256,
      audioSha256: inputProvenance.audioSha256,
    });
    await db.update(studioJobsTable).set({
      config: {
        ...config,
        generationQueued: true,
        commandId,
        requirements: presenterOutputContract,
        inputProvenance,
      },
      status: "rendering",
      progress: 58,
      eta: "waiting for Mac presenter worker",
      error: null,
    }).where(eq(studioJobsTable.id, job.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local worker failed";
    logger.error({ err: error, jobId: job.id }, "Studio job failed");
    await db.update(studioJobsTable).set({ status: "failed", eta: null, error: message }).where(eq(studioJobsTable.id, job.id));
  }
}

function subtitleTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const whole = Math.floor(seconds % 60);
  const millis = Math.round((seconds % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

async function processRenderJob(job: typeof renderJobsTable.$inferSelect) {
  try {
    await updateRenderProgress(job.id, 15, "about 20 seconds");
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, job.projectId)).limit(1);
    if (!project) throw new Error("Project no longer exists");
    const [plan] = await db.select().from(projectPlansTable).where(eq(projectPlansTable.projectId, job.projectId)).limit(1);
    const snapshotScenes = Array.isArray((job.options as JobConfig).scenes)
      ? (job.options as JobConfig).scenes as StoredScenePlan[]
      : [];
    const scenes = snapshotScenes.length ? snapshotScenes : (plan?.scenes ?? []).length ? plan!.scenes : [{
      index: 1,
      title: project.name,
      narration: project.description || "Local studio render",
      visualPrompt: "",
      durationSeconds: Math.max(4, project.durationSeconds || 8),
      assetStatus: "ready" as const,
    }];
    const timeline = compileTimeline(scenes);
    const subtitlePath = path.join(outputDir, outputName("render", job.id, ".srt"));
    const subtitles = timeline
      .filter(({ scene }) => scene.delivery.subtitlesEnabled)
      .map(({ scene, subtitleStartSeconds, subtitleEndSeconds }, index) =>
        `${index + 1}\n${subtitleTime(subtitleStartSeconds)} --> ${subtitleTime(subtitleEndSeconds)}\n${scene.narration.trim()}\n`,
      )
      .join("\n");
    const duration = Math.max(
      2,
      Math.min(120, timeline[timeline.length - 1]?.endSeconds ?? 2),
    );
    const sceneAudioPaths = await Promise.all(
      timeline.map(({ scene }, index) =>
        writeSpeech(
          scene.narration,
          { ...scene.delivery, text: scene.narration },
          outputName(`render-audio-${job.id}-${index + 1}`, job.id, ".wav"),
          scene.durationSeconds,
        ),
      ),
    );
    const audioPath = await combineWavFiles(
      sceneAudioPaths,
      outputName("render-audio", job.id, ".wav"),
    );
    await writeFile(subtitlePath, subtitles);
    await updateRenderProgress(job.id, 56, "about 9 seconds");
    if (await isRenderCancelled(job.id)) return;
    const portrait = job.preset === "shorts" || job.preset === "reels";
    const size = portrait ? "720x1280" : job.preset === "preview" ? "854x480" : "1920x1080";
    const outputPath = path.join(outputDir, outputName(`render-${job.preset}`, job.id, ".mp4"));
    const presenterScenes = timeline.filter(({ scene }) => scene.delivery.presenterMode !== "none");
    if (presenterScenes.length) {
      const presenterPaths = new Map<number, string>();
      for (const item of presenterScenes) {
        const sceneAudio = sceneAudioPaths[item.scene.index - 1];
        if (!sceneAudio) throw new Error(`Scene ${item.scene.index} voice track is missing`);
        presenterPaths.set(
          item.scene.index,
          await queuePresenterScene(job.id, job.projectId, item, sceneAudio),
        );
        await updateRenderProgress(job.id, 56 + Math.round((presenterPaths.size / presenterScenes.length) * 28), "generating presenter scenes on Mac");
        if (await isRenderCancelled(job.id)) return;
      }
      const segments: string[] = [];
      for (const item of timeline) {
        const sceneAudio = sceneAudioPaths[item.scene.index - 1];
        if (!sceneAudio) throw new Error(`Scene ${item.scene.index} voice track is missing`);
        const presenterPath = presenterPaths.get(item.scene.index);
        if (presenterPath) {
          segments.push(await composePresenterScene(job.id, item, presenterPath, sceneAudio, size, item.scene.index));
        } else {
          const segmentPath = path.join(outputDir, outputName(`render-background-${item.scene.index}`, job.id, ".mp4"));
          const sceneSubtitlePath = item.scene.delivery.subtitlesEnabled
            ? await sceneSubtitleFile(job.id, item, `background-${item.scene.index}`)
            : null;
          const sceneSubtitleFilter = sceneSubtitlePath
            ? `,subtitles=${sceneSubtitlePath}:force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'`
            : "";
          await runFfmpeg([
            "-f", "lavfi", "-i", `color=c=0x111827:s=${size}:d=${item.scene.durationSeconds}`,
            "-i", sceneAudio,
            "-t", String(item.scene.durationSeconds),
            "-vf", `drawtext=text='${item.scene.title.replace(/[:'\\]/g, " ")}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=h/2-80${sceneSubtitleFilter}`,
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", segmentPath,
          ]);
          segments.push(segmentPath);
        }
      }
      const presenterOutputPath = await concatVideoSegments(job.id, segments, size, duration);
      await updateRenderProgress(job.id, 92, "wrapping presenter delivery");
      if (await isRenderCancelled(job.id)) return;
      await db.update(renderJobsTable).set({
        status: "complete",
        progress: 100,
        eta: null,
        outputPath: `/api/files/${path.basename(presenterOutputPath)}`,
        subtitlePath: `/api/files/${path.basename(subtitlePath)}`,
        error: null,
        completedAt: new Date(),
      }).where(eq(renderJobsTable.id, job.id));
      await db.update(projectsTable).set({ status: "rendered" }).where(eq(projectsTable.id, project.id));
      return;
    }
    const filters = [
      `drawtext=text='${project.name.replace(/[:'\\]/g, " ")}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=h/2-80`,
      ...(subtitles ? [`subtitles=${subtitlePath}:force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'`] : []),
    ].join(",");
    await runFfmpeg([
      "-f", "lavfi", "-i", `color=c=0x111827:s=${size}:d=${duration}`,
      "-i", audioPath,
      "-t", String(duration),
      "-vf", filters,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", outputPath,
    ]);
    await updateRenderProgress(job.id, 92, "wrapping files");
    if (await isRenderCancelled(job.id)) return;
    await db.update(renderJobsTable).set({
      status: "complete",
      progress: 100,
      eta: null,
      outputPath: `/api/files/${path.basename(outputPath)}`,
      subtitlePath: `/api/files/${path.basename(subtitlePath)}`,
      error: null,
      completedAt: new Date(),
    }).where(eq(renderJobsTable.id, job.id));
    await db.update(projectsTable).set({ status: "rendered" }).where(eq(projectsTable.id, project.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render worker failed";
    logger.error({ err: error, jobId: job.id }, "Render job failed");
    await db.update(renderJobsTable).set({ status: "failed", eta: null, error: message }).where(eq(renderJobsTable.id, job.id));
  }
}

export async function processQueueOnce() {
  if (processing) return;
  processing = true;
  try {
    const [studio] = await db.select().from(studioJobsTable).where(eq(studioJobsTable.status, "queued")).orderBy(asc(studioJobsTable.createdAt)).limit(1);
     if (studio) {
      const [claimed] = await db.update(studioJobsTable).set({ status: "rendering", startedAt: new Date(), progress: 5, error: null }).where(and(eq(studioJobsTable.id, studio.id), eq(studioJobsTable.status, "queued"))).returning();
      if (claimed) await processStudioJob(claimed);
      return;
    }
    const [presenter] = await db
      .select()
      .from(studioJobsTable)
      .where(and(eq(studioJobsTable.status, "rendering"), sql`${studioJobsTable.kind} in ('presenter-lipsync', 'presenter-scene')`))
      .orderBy(asc(studioJobsTable.createdAt))
      .limit(1);
    if (presenter) {
      await processStudioJob(presenter);
      return;
    }
    const [render] = await db.select().from(renderJobsTable).where(eq(renderJobsTable.status, "queued")).orderBy(asc(renderJobsTable.createdAt)).limit(1);
    if (render) {
      const [claimed] = await db.update(renderJobsTable).set({ status: "rendering", startedAt: new Date(), progress: 5, error: null }).where(and(eq(renderJobsTable.id, render.id), eq(renderJobsTable.status, "queued"))).returning();
      if (claimed) await processRenderJob(claimed);
    }
  } catch (error) {
    logger.error({ err: error }, "Local worker queue tick failed");
  } finally {
    processing = false;
  }
}

export function startStudioWorker() {
  void ensureDirectories().then(async () => {
    await recoverInFlightJobs();
    if (workerTimer) return;
    workerTimer = setInterval(() => void processQueueOnce(), intervalMs);
    workerTimer.unref();
    void processQueueOnce();
  }).catch((error) => logger.error({ err: error }, "Unable to start local studio worker"));
}

export async function recoverInFlightJobs() {
  const inFlightBridgeJobs = await db
    .select({ id: studioJobsTable.id, config: studioJobsTable.config })
    .from(studioJobsTable)
    .where(and(
      eq(studioJobsTable.status, "rendering"),
      sql`${studioJobsTable.kind} in ('image', 'presenter-lipsync', 'presenter-scene')`,
    ));
  await db.update(studioJobsTable).set({ status: "queued", eta: "waiting for worker", startedAt: null }).where(eq(studioJobsTable.status, "rendering"));
  for (const job of inFlightBridgeJobs) {
    await db.update(studioJobsTable).set({
      config: { ...(job.config ?? {}), generationQueued: false, commandId: null, outputMetadata: null },
    }).where(eq(studioJobsTable.id, job.id));
  }
  await db.update(renderJobsTable).set({ status: "queued", eta: "waiting for worker", startedAt: null }).where(eq(renderJobsTable.status, "rendering"));
}

export function stopStudioWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = undefined;
}

export async function saveAsset(data: Buffer, name: string, mimeType: string, kind: string) {
  await ensureDirectories();
  const filename = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExtension(mimeType, path.extname(name) || ".bin")}`;
  const filePath = path.join(assetDir, filename);
  await writeFile(filePath, data);
  return filePath;
}

export async function readStudioFile(filename: string) {
  if (!/^[a-z0-9._-]+$/i.test(filename) || filename.includes("..")) return null;
  try {
    return await readFile(path.join(outputDir, filename));
  } catch {
    try {
      return await readFile(path.join(assetDir, filename));
    } catch {
      return null;
    }
  }
}

export function studioOutputPath() {
  return outputDir;
}