import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  activityTable,
  db,
  modelsTable,
  projectPlansTable,
  projectsTable,
  providersTable,
  renderJobsTable,
  studioAssetsTable,
  studioJobsTable,
} from "@workspace/db";
import {
  CancelRenderJobParams,
  CancelStudioJobParams,
  CreatePresenterJobBody,
  CreateImageJobBody,
  CreateImageJobResponse,
  CreateLiveCallTurnBody,
  CreateLiveCallTurnResponse,
  CreateProjectBody,
  CreateProjectPlanBody,
  CreateProjectPlanParams,
  CreateRenderJobBody,
  CreateVoiceJobBody,
  DeleteProjectParams,
  GetActivityResponse,
  GetProjectParams,
  GetProjectResponse,
  GetProjectPlanParams,
  GetProjectPlanResponse,
  GetStudioOverviewResponse,
  GetSystemReadinessResponse,
  InstallModelParams,
  ListModelsResponse,
  ListProjectsResponse,
  ListProvidersResponse,
  ListRenderJobsResponse,
  ListStudioAssetsResponse,
  ListStudioJobsResponse,
  ImportStudioAssetBody,
  ImportStudioAssetResponse,
  CreatePresenterJobResponse,
  CreateVoiceJobResponse,
  CancelStudioJobResponse,
  RetryStudioJobParams,
  RetryStudioJobResponse,
  RetryRenderJobParams,
  RetryRenderJobResponse,
  ScanSystemReadinessResponse,
  UpdateProjectBody,
  UpdateProjectPlanBody,
  UpdateProjectPlanResponse,
  UpdateProjectParams,
  UpdateProviderBody,
  UpdateProviderParams,
  AcknowledgeBridgeCommandParams,
  ApproveStudioJobParams,
  ApproveStudioJobResponse,
  ApproveModelInstallParams,
  BridgeHandshakeBody,
  BridgeHeartbeatBody,
  CreateBridgePairingResponse,
  GetModelInstallParams,
  GetModelInstallResponse,
  InstallModelResponse,
  ListBridgeCommandsResponse,
  ReportHuggingFaceCredentialBody,
  ReportHuggingFaceCredentialResponse,
  ReportInstallEventBody,
  ReportInstallEventParams,
  ReportInstallEventResponse,
  RequestProviderCredentialParams,
  RequestProviderCredentialResponse,
  RetryModelInstallResponse,
  RetryModelInstallParams,
  ReportPresenterJobEventBody,
  ReportPresenterJobEventParams,
  ReportPresenterJobEventResponse,
  UploadPresenterOutputBody,
  UploadPresenterOutputParams,
  UploadPresenterOutputResponse,
  UploadImageOutputBody,
  UploadImageOutputParams,
  UploadImageOutputResponse,
} from "@workspace/api-zod";
import type { StoredScenePlan } from "@workspace/db";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  presenterOutputContract,
  burnPresenterSubtitles,
  readStudioFile,
  saveAsset,
  savePresenterOutput,
  saveImageOutput,
  startStudioWorker,
  verifyPresenterVideo,
} from "../lib/studio-worker";
import {
  BridgeError,
  acknowledgeCommand,
  authenticateWorker,
  approveInstall,
  bridgeHandshake,
  bridgeHeartbeat,
  createCredentialRequest,
  createInstall,
  createPairing,
  getCredentialRequest,
  getInstall,
  listCommands,
  readinessReport,
  requireConnected,
  retryInstall,
  updateCredentialRequest,
  updateInstall,
  imageRequirements,
} from "../lib/bridge";

const router: IRouter = Router();

const iso = (value: Date | string | null) =>
  value instanceof Date ? value.toISOString() : value;

const defaultSceneDelivery = {
  voiceProfileId: null,
  rate: 1,
  pitch: 0,
  pauseMs: 120,
  pronunciation: null,
  presenterAssetId: null,
  presenterMode: "none" as const,
  presenterFraming: "full-body" as const,
  presenterDeliveryMode: "presentational" as const,
  subtitlesEnabled: true,
};

function normalizeScene(scene: StoredScenePlan) {
  const durationSeconds = Math.max(1, Math.min(120, Number(scene.durationSeconds) || 4));
  const delivery = {
    ...defaultSceneDelivery,
    ...(scene.delivery ?? {}),
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

function productionPlanResponse(plan: {
  projectId: number;
  title: string;
  summary: string;
  scenes: StoredScenePlan[];
}) {
  const scenes = plan.scenes.map(normalizeScene);
  return {
    projectId: plan.projectId,
    title: plan.title,
    summary: plan.summary,
    sceneCount: scenes.length,
    estimatedDurationSeconds: Math.ceil(
      scenes.reduce((total, scene) => total + scene.durationSeconds, 0),
    ),
    scenes,
  };
}

function projectResponse(project: typeof projectsTable.$inferSelect) {
  return {
    ...project,
    updatedAt: iso(project.updatedAt),
  };
}

function renderResponse(
  job: typeof renderJobsTable.$inferSelect,
  projectName: string,
) {
  return {
    ...job,
    projectName,
    outputPath: job.outputPath ?? null,
    subtitlePath: job.subtitlePath ?? null,
    error: job.error ?? null,
    startedAt: iso(job.startedAt ?? null),
    completedAt: iso(job.completedAt ?? null),
    createdAt: iso(job.createdAt),
  };
}

function assetResponse(asset: typeof studioAssetsTable.$inferSelect) {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    consentGranted: asset.consentGranted,
    consentSubject: asset.consentSubject ?? null,
    fileUrl: `/api/files/${path.basename(asset.filePath)}`,
    createdAt: iso(asset.createdAt),
  };
}

function studioJobResponse(job: typeof studioJobsTable.$inferSelect) {
  const config = (job.config ?? {}) as Record<string, unknown>;
  return {
    id: job.id,
    kind: job.kind,
    projectId: job.projectId ?? null,
    assetId: job.assetId ?? null,
    status: job.status,
    progress: job.progress,
    eta: job.eta ?? null,
    outputPath: job.outputPath ?? null,
    error: job.error ?? null,
    requirements: (config.requirements as Record<string, unknown> | undefined) ?? {
      localOnly: true,
      output: job.kind === "voice"
        ? "WAV audio"
        : job.kind === "image"
          ? imageRequirements.output
          : presenterOutputContract.output,
    },
    outputMetadata: (config.outputMetadata as Record<string, unknown> | undefined) ?? null,
    createdAt: iso(job.createdAt),
    updatedAt: iso(job.updatedAt),
  };
}

if (process.env.NODE_ENV !== "test") {
  startStudioWorker();
}

router.get("/studio/overview", async (_req, res) => {
  const [projects, jobs, models, readiness] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(projectsTable)
      .where(sql`${projectsTable.status} <> 'archived'`),
    db
      .select({ count: sql<number>`count(*)` })
      .from(renderJobsTable)
      .where(sql`${renderJobsTable.status} in ('queued', 'rendering')`),
    db
      .select({ count: sql<number>`count(*)` })
      .from(modelsTable)
      .where(eq(modelsTable.status, "installed")),
    getReadiness(),
  ]);

  const currentJob = await db
    .select({
      projectName: projectsTable.name,
      preset: renderJobsTable.preset,
      status: renderJobsTable.status,
    })
    .from(renderJobsTable)
    .innerJoin(projectsTable, eq(renderJobsTable.projectId, projectsTable.id))
    .where(sql`${renderJobsTable.status} in ('queued', 'rendering')`)
    .orderBy(asc(renderJobsTable.id))
    .limit(1);

  return res.json(
    GetStudioOverviewResponse.parse({
      activeProjects: Number(projects[0]?.count ?? 0),
      renderQueue: Number(jobs[0]?.count ?? 0),
      installedModels: Number(models[0]?.count ?? 0),
      readiness: readiness.status,
      readinessLabel: readiness.status === "ready"
        ? "Signed Mac worker ready"
        : readiness.status === "offline"
          ? "Signed Mac worker offline"
          : "Signed Mac worker needs attention",
      gpuMemory: readiness.memory,
      currentTask: currentJob[0]
        ? `${currentJob[0].status === "rendering" ? "Rendering" : "Queued"} · ${currentJob[0].projectName}`
        : null,
    }),
  );
});

router.get("/activity", async (_req, res) => {
  const rows = await db
    .select()
    .from(activityTable)
    .orderBy(desc(activityTable.createdAt))
    .limit(20);
  return res.json(
    GetActivityResponse.parse(
      rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
    ),
  );
});

router.get("/projects", async (_req, res) => {
  const rows = await db
    .select()
    .from(projectsTable)
    .where(sql`${projectsTable.status} <> 'archived'`)
    .orderBy(desc(projectsTable.updatedAt));
  return res.json(ListProjectsResponse.parse(rows.map(projectResponse)));
});

router.post("/projects", async (req, res) => {
  const input = CreateProjectBody.parse(req.body);
  const [project] = await db
    .insert(projectsTable)
    .values({
      name: input.name,
      description: input.description ?? "",
      format: input.format ?? "landscape",
    })
    .returning();

  await db.insert(activityTable).values({
    kind: "project",
    title: "Project created",
    detail: `${project.name} is ready for planning`,
  });
  return res.status(201).json(projectResponse(project));
});

router.get("/projects/:projectId", async (req, res) => {
  const { projectId } = GetProjectParams.parse(req.params);
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project || project.status === "archived") {
    return res.status(404).json({ error: "Project not found" });
  }
  return res.json(GetProjectResponse.parse(projectResponse(project)));
});

router.patch("/projects/:projectId", async (req, res) => {
  const { projectId } = UpdateProjectParams.parse(req.params);
  const input = UpdateProjectBody.parse(req.body);
  const [project] = await db
    .update(projectsTable)
    .set(input)
    .where(eq(projectsTable.id, projectId))
    .returning();
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  return res.json(projectResponse(project));
});

router.delete("/projects/:projectId", async (req, res) => {
  const { projectId } = DeleteProjectParams.parse(req.params);
  const [project] = await db
    .update(projectsTable)
    .set({ status: "archived" })
    .where(eq(projectsTable.id, projectId))
    .returning();
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  return res.status(204).send();
});

router.get("/projects/:projectId/plan", async (req, res) => {
  const { projectId } = GetProjectPlanParams.parse(req.params);
  const [plan] = await db
    .select()
    .from(projectPlansTable)
    .where(eq(projectPlansTable.projectId, projectId))
    .limit(1);
  if (!plan) {
    return res.status(404).json({ error: "Production plan not found" });
  }
  return res.json(
    GetProjectPlanResponse.parse(
      productionPlanResponse({
        projectId: plan.projectId,
        title: plan.title,
        summary: plan.summary,
        scenes: plan.scenes,
      }),
    ),
  );
});

router.post("/projects/:projectId/plan", async (req, res) => {
  const { projectId } = CreateProjectPlanParams.parse(req.params);
  const input = CreateProjectPlanBody.parse(req.body);
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project || project.status === "archived") {
    return res.status(404).json({ error: "Project not found" });
  }

  const lines = input.script
    .split(/\n+|(?<=[.!?।])\s+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const sourceScenes = lines.length > 0 ? lines : [input.script.trim()];
  const [previousPlan] = await db
    .select()
    .from(projectPlansTable)
    .where(eq(projectPlansTable.projectId, projectId))
    .limit(1);
  const previousScenes = new Map(
    (previousPlan?.scenes ?? []).map((scene) => [scene.index, scene]),
  );
  const scenes = sourceScenes.slice(0, 12).map((narration, index) => normalizeScene({
    index: index + 1,
    title: `Scene ${String(index + 1).padStart(2, "0")}`,
    narration,
    visualPrompt: `Realistic human-presenter production shot, ${input.tone} tone, ${narration}`,
    durationSeconds: Math.max(4, Math.ceil(narration.split(/\s+/).length / 2.4)),
    assetStatus: "pending" as const,
    subtitleStartSeconds: previousScenes.get(index + 1)?.subtitleStartSeconds,
    subtitleEndSeconds: previousScenes.get(index + 1)?.subtitleEndSeconds,
    delivery: previousScenes.get(index + 1)?.delivery,
  }));
  const estimatedDurationSeconds = scenes.reduce(
    (total, scene) => total + scene.durationSeconds,
    0,
  );
  const plan = {
    projectId,
    title: project.name,
    summary: `A ${input.tone} production plan in ${input.language === "bn" ? "Bangla" : input.language === "en" ? "English" : "mixed language"}.`,
    sceneCount: scenes.length,
    estimatedDurationSeconds,
    scenes,
  };

  await db
    .insert(projectPlansTable)
    .values({
      projectId,
      title: plan.title,
      summary: plan.summary,
      sceneCount: plan.sceneCount,
      estimatedDurationSeconds,
      scenes,
    })
    .onConflictDoUpdate({
      target: projectPlansTable.projectId,
      set: {
        title: plan.title,
        summary: plan.summary,
        sceneCount: plan.sceneCount,
        estimatedDurationSeconds,
        scenes,
        updatedAt: new Date(),
      },
    });
  await db
    .update(projectsTable)
    .set({
      status: "planning",
      durationSeconds: estimatedDurationSeconds,
      scenes: scenes.length,
    })
    .where(eq(projectsTable.id, projectId));
  await db.insert(activityTable).values({
    kind: "project",
    title: "Production plan created",
    detail: `${scenes.length} scenes mapped for ${project.name}`,
  });
  return res.json(plan);
});

router.patch("/projects/:projectId/plan", async (req, res) => {
  const { projectId } = GetProjectPlanParams.parse(req.params);
  const input = UpdateProjectPlanBody.parse(req.body);
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  const [existingPlan] = await db
    .select()
    .from(projectPlansTable)
    .where(eq(projectPlansTable.projectId, projectId))
    .limit(1);
  if (!project || project.status === "archived") {
    return res.status(404).json({ error: "Project not found" });
  }
  if (!existingPlan) {
    return res.status(404).json({ error: "Production plan not found" });
  }

  const scenes = input.scenes.map((scene) => normalizeScene(scene));
  const indices = scenes.map((scene) => scene.index);
  if (
    indices.some((index, position) => index !== position + 1) ||
    scenes.some((scene) => scene.subtitleEndSeconds <= scene.subtitleStartSeconds) ||
    scenes.some((scene) => scene.delivery.presenterMode !== "none" && scene.delivery.presenterAssetId === null) ||
    scenes.reduce((total, scene) => total + scene.durationSeconds, 0) > 120
  ) {
    return res.status(400).json({
      error: "Scene indices, subtitle ranges, and total duration are invalid",
    });
  }

  const voiceProfileIds = scenes
    .map((scene) => scene.delivery.voiceProfileId)
    .filter((id): id is number => id !== null);
  const presenterAssetIds = scenes
    .map((scene) => scene.delivery.presenterAssetId)
    .filter((id): id is number => id !== null);
  const [voiceProfiles, presenterAssets] = await Promise.all([
    voiceProfileIds.length
      ? db
          .select({ id: studioAssetsTable.id })
          .from(studioAssetsTable)
          .where(
            and(
              inArray(studioAssetsTable.id, voiceProfileIds),
              eq(studioAssetsTable.kind, "voice-profile"),
              eq(studioAssetsTable.consentGranted, true),
            ),
          )
      : [],
    presenterAssetIds.length
      ? db
          .select({ id: studioAssetsTable.id })
          .from(studioAssetsTable)
          .where(
            and(
              inArray(studioAssetsTable.id, presenterAssetIds),
              eq(studioAssetsTable.kind, "presenter-reference"),
              eq(studioAssetsTable.consentGranted, true),
            ),
          )
      : [],
  ]);
  if (
    voiceProfiles.length !== new Set(voiceProfileIds).size ||
    presenterAssets.length !== new Set(presenterAssetIds).size
  ) {
    return res.status(400).json({ error: "Selected delivery assets are not consented" });
  }

  const estimatedDurationSeconds = Math.ceil(
    scenes.reduce((total, scene) => total + scene.durationSeconds, 0),
  );
  const [updatedPlan] = await db
    .update(projectPlansTable)
    .set({
      sceneCount: scenes.length,
      estimatedDurationSeconds,
      scenes,
      updatedAt: new Date(),
    })
    .where(eq(projectPlansTable.projectId, projectId))
    .returning();
  await db
    .update(projectsTable)
    .set({
      status: "planning",
      durationSeconds: estimatedDurationSeconds,
      scenes: scenes.length,
    })
    .where(eq(projectsTable.id, projectId));
  await db.insert(activityTable).values({
    kind: "project",
    title: "Scene delivery updated",
    detail: `${scenes.length} scenes tuned for ${project.name}`,
  });
  return res.json(
    UpdateProjectPlanResponse.parse(
      productionPlanResponse({
        projectId: updatedPlan.projectId,
        title: updatedPlan.title,
        summary: updatedPlan.summary,
        scenes: updatedPlan.scenes,
      }),
    ),
  );
});

async function getReadiness() {
  return readinessReport();
}

router.get("/system/readiness", async (_req, res) => {
  return res.json(GetSystemReadinessResponse.parse(await getReadiness()));
});

router.post("/system/readiness/scan", async (_req, res) => {
  const report = await getReadiness();
  return res.json(
    ScanSystemReadinessResponse.parse({
      ...report,
      lastScanAt: new Date().toISOString(),
    }),
  );
});

router.post("/system/bridge/pairing", (_req, res) => {
  return res.status(201).json(CreateBridgePairingResponse.parse(createPairing()));
});

router.post("/system/bridge/handshake", (req, res) => {
  try {
    const input = BridgeHandshakeBody.parse(req.body);
    const report = bridgeHandshake(
      {
        workerId: input.workerId,
        protocolVersion: input.protocolVersion,
        workerVersion: input.workerVersion,
        deviceName: input.deviceName,
        chip: input.chip,
        memoryGb: input.memoryGb,
        metal: input.metal,
        mps: input.mps,
        mlx: input.mlx,
        diskFreeGb: input.diskFreeGb,
        diskTotalGb: input.diskTotalGb,
        runtime: input.runtime,
        permissions: input.permissions,
        presenterPipeline: input.presenterPipeline,
        presenterModel: input.presenterModel,
        imagePipeline: input.imagePipeline,
        imageModel: input.imageModel,
      },
      input.pairingCode,
      input.nonce,
      input.signature,
      { ...(req.body as Record<string, unknown>), signature: "" },
    );
    return res.json(report);
  } catch (error) {
    if (error instanceof BridgeError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
});

router.post("/system/bridge/heartbeat", (req, res) => {
  try {
    const input = BridgeHeartbeatBody.parse(req.body);
    return res.json(bridgeHeartbeat(
      input.workerId,
      input.nonce,
      input.signature,
      { ...(req.body as Record<string, unknown>), signature: "" },
    ));
  } catch (error) {
    if (error instanceof BridgeError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
});

function bridgeHeaders(req: Request) {
  const workerId = req.header("x-studio-worker-id") ?? "";
  const nonce = req.header("x-studio-nonce") ?? "";
  const signature = req.header("x-studio-signature") ?? "";
  authenticateWorker(workerId, nonce, signature, req.method, req.path, req.body);
}

router.get("/system/bridge/commands", (req, res) => {
  try {
    bridgeHeaders(req);
    return res.json(ListBridgeCommandsResponse.parse(listCommands()));
  } catch (error) {
    if (error instanceof BridgeError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
});

router.post("/system/bridge/commands/:commandId/ack", (req, res) => {
  try {
    const { commandId } = AcknowledgeBridgeCommandParams.parse(req.params);
    bridgeHeaders(req);
    acknowledgeCommand(commandId);
    return res.status(204).send();
  } catch (error) {
    if (error instanceof BridgeError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
});

router.post("/system/bridge/jobs/:jobId/events", async (req, res) => {
  try {
    const { jobId } = ReportInstallEventParams.parse(req.params);
    const input = ReportInstallEventBody.parse(req.body);
    bridgeHeaders(req);
    const job = updateInstall(jobId, input.status, input.progress, input.message, input.error);
    if (input.status === "complete") {
      await db.update(modelsTable).set({ status: "installed" }).where(eq(modelsTable.id, job.modelId));
    } else if (input.status === "failed") {
      await db.update(modelsTable).set({ status: "attention" }).where(eq(modelsTable.id, job.modelId));
    } else if (input.status === "downloading" || input.status === "installing" || input.status === "queued") {
      await db.update(modelsTable).set({ status: "installing" }).where(eq(modelsTable.id, job.modelId));
    }
    return res.json(ReportInstallEventResponse.parse(job));
  } catch (error) {
    if (error instanceof BridgeError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
});

router.post("/system/bridge/studio-jobs/:jobId/events", async (req, res) => {
  try {
    const { jobId } = ReportPresenterJobEventParams.parse(req.params);
    const input = ReportPresenterJobEventBody.parse(req.body);
    bridgeHeaders(req);
    const [job] = await db
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.id, jobId))
      .limit(1);
    if (!job || (job.kind !== "image" && job.kind !== "presenter-lipsync" && job.kind !== "presenter-scene")) {
      return res.status(404).json({ error: "Worker job not found" });
    }
    if (job.status === "cancelled") {
      return res.status(409).json({ error: "Worker job was cancelled" });
    }
    if (job.status !== "queued" && job.status !== "rendering") {
      return res.status(409).json({ error: "Worker job is not active" });
    }
    const config = (job.config ?? {}) as Record<string, unknown>;
    const nextStatus = input.status === "failed" ? "failed" : input.status === "complete" ? "rendering" : "rendering";
    const [updated] = await db.update(studioJobsTable).set({
      status: nextStatus,
      progress: input.progress,
      eta: input.status === "failed"
        ? null
        : job.kind === "image"
          ? "Mac worker generating image"
          : "Mac worker generating human performance",
      error: input.status === "failed" ? input.error ?? input.message : null,
      config: { ...config, workerMessage: input.message },
    }).where(eq(studioJobsTable.id, jobId)).returning();
    return res.json(ReportPresenterJobEventResponse.parse(studioJobResponse(updated)));
  } catch (error) {
    if (error instanceof BridgeError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
});

router.post("/system/bridge/studio-jobs/:jobId/image-output", async (req, res) => {
  try {
    const { jobId } = UploadImageOutputParams.parse(req.params);
    const input = UploadImageOutputBody.parse(req.body);
    bridgeHeaders(req);
    const [job] = await db
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.id, jobId))
      .limit(1);
    if (!job || job.kind !== "image") {
      return res.status(404).json({ error: "Image job not found" });
    }
    if (job.status === "cancelled") {
      return res.status(409).json({ error: "Image job was cancelled" });
    }
    if (job.status !== "queued" && job.status !== "rendering") {
      return res.status(409).json({ error: "Image job is not active" });
    }
    const data = Buffer.from(input.data, "base64");
    const config = (job.config ?? {}) as Record<string, unknown>;
    const metadata = input.metadata;
    const isPng = data.length >= 33
      && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && data.subarray(12, 16).toString("ascii") === "IHDR";
    const actualWidth = isPng ? data.readUInt32BE(16) : 0;
    const actualHeight = isPng ? data.readUInt32BE(20) : 0;
    if (
      !isPng
      || data.length > 30 * 1024 * 1024
      || actualWidth !== Number(config.width)
      || actualHeight !== Number(config.height)
    ) {
      return res.status(400).json({ error: "Image output must be a valid PNG under 30 MB with the requested dimensions" });
    }
    if (
      metadata.pipeline !== imageRequirements.pipeline
      || typeof metadata.model !== "string"
      || !metadata.model.trim()
      || metadata.promptSha256 !== createHash("sha256").update(String(config.prompt ?? "")).digest("hex")
      || metadata.negativePromptSha256 !== createHash("sha256").update(String(config.negativePrompt ?? "")).digest("hex")
      || metadata.width !== String(config.width)
      || metadata.height !== String(config.height)
      || metadata.steps !== String(config.steps)
      || metadata.guidance !== String(config.guidance)
      || metadata.seed !== String(config.seed)
      || metadata.outputSha256 !== createHash("sha256").update(data).digest("hex")
    ) {
      return res.status(400).json({ error: "Image output provenance did not match the queued generation settings" });
    }
    const outputPath = await saveImageOutput(data, job.id);
    const outputMetadata = {
      ...metadata,
      mimeType: input.mimeType,
      width: config.width,
      height: config.height,
      steps: config.steps,
      guidance: config.guidance,
      seed: config.seed,
      verified: true,
      verifiedAt: new Date().toISOString(),
    };
    const [updated] = await db.update(studioJobsTable).set({
      status: "complete",
      progress: 100,
      eta: null,
      outputPath: `/api/files/${path.basename(outputPath)}`,
      error: null,
      config: { ...config, outputMetadata },
      completedAt: new Date(),
    }).where(eq(studioJobsTable.id, job.id)).returning();
    return res.json(UploadImageOutputResponse.parse(studioJobResponse(updated)));
  } catch (error) {
    if (error instanceof BridgeError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
});

router.post("/system/bridge/studio-jobs/:jobId/output", async (req, res) => {
  try {
    const { jobId } = UploadPresenterOutputParams.parse(req.params);
    const input = UploadPresenterOutputBody.parse(req.body);
    bridgeHeaders(req);
    const [job] = await db
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.id, jobId))
      .limit(1);
    if (!job || (job.kind !== "presenter-lipsync" && job.kind !== "presenter-scene")) {
      return res.status(404).json({ error: "Presenter job not found" });
    }
    if (job.status === "cancelled") {
      return res.status(409).json({ error: "Presenter job was cancelled" });
    }
    if (job.status !== "queued" && job.status !== "rendering") {
      return res.status(409).json({ error: "Presenter job is not active" });
    }
    const [presenterAsset] = job.assetId
      ? await db
          .select()
          .from(studioAssetsTable)
          .where(
            and(
              eq(studioAssetsTable.id, job.assetId),
              eq(studioAssetsTable.kind, "presenter-reference"),
            ),
          )
          .limit(1)
      : [];
    if (
      !presenterAsset ||
      presenterAsset.consentGranted !== true ||
      presenterAsset.metadata?.referenceType !== "real-human"
    ) {
      return res.status(400).json({
        error: "Presenter output requires a consented real-human reference.",
      });
    }
    const metadata = input.metadata;
    const config = (job.config ?? {}) as Record<string, unknown>;
    const provenance = config.inputProvenance as Record<string, unknown> | undefined;
    if (
      metadata.pipeline !== presenterOutputContract.pipeline ||
      metadata.referenceType !== "real-human" ||
      metadata.outputType !== "real-human-performance" ||
      metadata.speechSynchronized !== true ||
      metadata.motionVerified !== true ||
      typeof metadata.model !== "string" ||
      !metadata.model.trim() ||
      metadata.framing !== config.framing ||
      metadata.deliveryMode !== config.deliveryMode
      || !provenance
      || metadata.referenceSha256 !== provenance.referenceSha256
      || metadata.audioSha256 !== provenance.audioSha256
      || metadata.outputSha256 !== createHash("sha256").update(Buffer.from(input.data, "base64")).digest("hex")
    ) {
      return res.status(400).json({
        error: "Presenter output provenance did not match the immutable consented reference and local voice track.",
      });
    }
    const data = Buffer.from(input.data, "base64");
    if (!data.length || data.length > 100 * 1024 * 1024) {
      return res.status(400).json({ error: "Presenter output must be a non-empty MP4 under 100 MB" });
    }
    let outputPath = await savePresenterOutput(data, job.id);
    const durationSeconds = Math.max(1, Math.min(120, Number(config.durationSeconds ?? 20)));
    let verified;
    try {
      verified = await verifyPresenterVideo(outputPath, durationSeconds);
      const captionedPath = await burnPresenterSubtitles(
        outputPath,
        job.id,
        String(config.script ?? ""),
        durationSeconds,
      );
      verified = await verifyPresenterVideo(captionedPath, durationSeconds);
      outputPath = captionedPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Presenter output verification failed";
      await db.update(studioJobsTable).set({
        status: "failed",
        progress: 100,
        eta: null,
        error: message,
        config: { ...config, outputMetadata: { ...metadata, verificationError: message } },
      }).where(eq(studioJobsTable.id, job.id));
      return res.status(400).json({ error: message });
    }
    const outputMetadata = {
      ...metadata,
      mimeType: input.mimeType,
      subtitlesEmbedded: true,
      consent: {
        assetId: presenterAsset.id,
        granted: presenterAsset.consentGranted,
        subject: presenterAsset.consentSubject,
        referenceType: presenterAsset.metadata.referenceType,
        referenceName: presenterAsset.name,
        referenceMimeType: presenterAsset.mimeType,
        referenceSha256: presenterAsset.metadata.sha256 ?? null,
      },
      provenance: {
        referenceSha256: provenance.referenceSha256,
        audioSha256: provenance.audioSha256,
        outputSha256: metadata.outputSha256,
      },
      verified,
      verifiedAt: new Date().toISOString(),
    };
    const [updated] = await db.update(studioJobsTable).set({
      status: "review",
      progress: 100,
      eta: "Director review required",
      outputPath: `/api/files/${path.basename(outputPath)}`,
      error: null,
      config: { ...config, outputMetadata: { ...outputMetadata, reviewRequired: true } },
      completedAt: null,
    }).where(eq(studioJobsTable.id, job.id)).returning();
    return res.json(UploadPresenterOutputResponse.parse(studioJobResponse(updated)));
  } catch (error) {
    if (error instanceof BridgeError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
});

router.post("/system/bridge/credentials/huggingface", async (req, res) => {
  try {
    const input = ReportHuggingFaceCredentialBody.parse(req.body);
    bridgeHeaders(req);
    const pendingRequest = getCredentialRequest(input.requestId);
    if (!pendingRequest || pendingRequest.providerId !== input.providerId) {
      return res.status(409).json({ error: "Credential confirmation does not match a pending request." });
    }
    const [requestedProvider] = await db
      .select({ kind: providersTable.kind })
      .from(providersTable)
      .where(eq(providersTable.id, input.providerId))
      .limit(1);
    if (!requestedProvider || requestedProvider.kind !== "huggingface") {
      return res.status(400).json({ error: "Credential confirmation is only valid for Hugging Face." });
    }
    const request = updateCredentialRequest(input.requestId, input.stored, input.detail);
    const [provider] = await db
      .update(providersTable)
      .set({
        status: input.stored ? "connected" : "error",
        detail: input.stored
          ? "Credential stored in macOS Keychain; token value is not held by Studio."
          : input.detail,
        tokenConfigured: input.stored,
      })
      .where(eq(providersTable.id, input.providerId))
      .returning();
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    return res.json(
      ReportHuggingFaceCredentialResponse.parse({
        ...provider,
        credentialStorage: input.stored ? "macos-keychain" : "none",
      }),
    );
  } catch (error) {
    if (error instanceof BridgeError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
});

router.get("/models", async (_req, res) => {
  const rows = await db.select().from(modelsTable).orderBy(desc(modelsTable.recommended), asc(modelsTable.name));
  return res.json(ListModelsResponse.parse(rows));
});

router.post("/models/:modelId/install", async (req, res) => {
  const { modelId } = InstallModelParams.parse(req.params);
  requireConnected();
  const [model] = await db.select().from(modelsTable).where(eq(modelsTable.id, modelId)).limit(1);
  if (!model) {
    return res.status(404).json({ error: "Model not found" });
  }
  const job = createInstall(model.id, model.name);
  await db.insert(activityTable).values({
    kind: "model",
    title: "Model install awaiting approval",
    detail: `${model.name} is ready for Mac worker approval`,
  });
  return res.status(202).json(InstallModelResponse.parse(job));
});

router.get("/models/:modelId/install", async (req, res) => {
  const { modelId } = GetModelInstallParams.parse(req.params);
  const job = getInstall(modelId);
  if (!job) return res.status(404).json({ error: "Installation job not found" });
  return res.json(GetModelInstallResponse.parse(job));
});

router.post("/models/:modelId/install/approve", async (req, res) => {
  try {
    const { modelId } = ApproveModelInstallParams.parse(req.params);
    const job = approveInstall(modelId);
    await db.update(modelsTable).set({ status: "installing" }).where(eq(modelsTable.id, modelId));
    await db.insert(activityTable).values({
      kind: "model",
      title: "Model install approved",
      detail: `${job.modelName} is queued on the signed Mac worker`,
    });
    return res.json(InstallModelResponse.parse(job));
  } catch (error) {
    if (error instanceof BridgeError) return res.status(error.statusCode).json({ error: error.message });
    throw error;
  }
});

router.post("/models/:modelId/install/retry", async (req, res) => {
  try {
    const { modelId } = RetryModelInstallParams.parse(req.params);
    const job = retryInstall(modelId);
    await db.update(modelsTable).set({ status: "installing" }).where(eq(modelsTable.id, modelId));
    await db.insert(activityTable).values({
      kind: "model",
      title: "Model install retry queued",
      detail: `${job.modelName} will retry on the signed Mac worker`,
    });
    return res.json(RetryModelInstallResponse.parse(job));
  } catch (error) {
    if (error instanceof BridgeError) return res.status(error.statusCode).json({ error: error.message });
    throw error;
  }
});

function providerResponse(provider: typeof providersTable.$inferSelect) {
  return {
    ...provider,
    credentialStorage: provider.kind === "huggingface" && provider.tokenConfigured ? "macos-keychain" : "none",
  };
}

router.post("/providers/:providerId/credential/request", async (req, res) => {
  try {
    const { providerId } = RequestProviderCredentialParams.parse(req.params);
    const [provider] = await db
      .select({ kind: providersTable.kind })
      .from(providersTable)
      .where(eq(providersTable.id, providerId))
      .limit(1);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    if (provider.kind !== "huggingface") {
      return res.status(400).json({ error: "Only Hugging Face credentials use the Mac Keychain flow" });
    }
    const request = createCredentialRequest(providerId);
    return res.status(202).json(RequestProviderCredentialResponse.parse(request));
  } catch (error) {
    if (error instanceof BridgeError) return res.status(error.statusCode).json({ error: error.message });
    throw error;
  }
});

router.get("/providers", async (_req, res) => {
  const rows = await db.select().from(providersTable).orderBy(asc(providersTable.id));
  return res.json(ListProvidersResponse.parse(rows.map(providerResponse)));
});

router.patch("/providers/:providerId", async (req, res) => {
  const { providerId } = UpdateProviderParams.parse(req.params);
  const input = UpdateProviderBody.parse(req.body);
  const [provider] = await db
    .update(providersTable)
    .set(input)
    .where(eq(providersTable.id, providerId))
    .returning();
  if (!provider) {
    return res.status(404).json({ error: "Provider not found" });
  }
  return res.json(providerResponse(provider));
});

router.get("/assets", async (_req, res) => {
  const assets = await db
    .select()
    .from(studioAssetsTable)
    .orderBy(desc(studioAssetsTable.createdAt));
  return res.json(ListStudioAssetsResponse.parse(assets.map(assetResponse)));
});

router.post("/assets", async (req, res) => {
  const input = ImportStudioAssetBody.parse(req.body);
  if (!input.consentGranted) {
    return res.status(400).json({ error: "Explicit consent is required before importing a voice or presenter reference" });
  }
  if (input.kind === "presenter-reference" && input.referenceType !== "real-human") {
    return res.status(400).json({ error: "Presenter references must be explicitly identified as a real human; avatar or illustrated references are not accepted" });
  }
  const isVoice = input.kind === "voice-profile";
  const validMime = isVoice ? input.mimeType.startsWith("audio/") : input.mimeType.startsWith("image/") || input.mimeType.startsWith("video/");
  if (!validMime) {
    return res.status(400).json({ error: `${isVoice ? "Voice profiles require an audio file" : "Presenter references require an image or video file"}` });
  }
  const data = Buffer.from(input.data, "base64");
  if (!data.length || data.length > 50 * 1024 * 1024) {
    return res.status(400).json({ error: "Asset must be between 1 byte and 50 MB" });
  }
  const filePath = await saveAsset(data, input.name, input.mimeType, input.kind);
  const [asset] = await db.insert(studioAssetsTable).values({
    kind: input.kind,
    name: input.name,
    filePath,
    mimeType: input.mimeType,
    sizeBytes: data.length,
    consentGranted: true,
    consentSubject: input.consentSubject,
    metadata: { importedLocally: true, ...(input.kind === "presenter-reference" ? { referenceType: "real-human" } : {}) },
  }).returning();
  await db.insert(activityTable).values({
    kind: "system",
    title: isVoice ? "Voice profile imported" : "Presenter reference imported",
    detail: `${input.name} is available to the local worker`,
  });
  return res.status(201).json(ImportStudioAssetResponse.parse(assetResponse(asset)));
});

async function sendStudioFile(filename: string, res: Response) {
  const data = await readStudioFile(filename);
  if (!data) {
    res.status(404).json({ error: "Output file not found" });
    return;
  }
  const extension = path.extname(filename).toLowerCase();
  const mime = extension === ".wav"
    ? "audio/wav"
    : extension === ".mp4"
      ? "video/mp4"
      : extension === ".png"
        ? "image/png"
        : extension === ".srt"
          ? "text/plain; charset=utf-8"
          : "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(filename)}"`);
  res.send(data);
}

router.get("/system/bridge/files/:filename", async (req, res) => {
  try {
    bridgeHeaders(req);
    await sendStudioFile(String(req.params.filename), res);
  } catch (error) {
    if (error instanceof BridgeError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/files/:filename", async (req, res) => {
  await sendStudioFile(String(req.params.filename), res);
});

router.get("/studio-jobs", async (_req, res) => {
  const jobs = await db.select().from(studioJobsTable).orderBy(desc(studioJobsTable.createdAt));
  return res.json(ListStudioJobsResponse.parse(jobs.map(studioJobResponse)));
});

router.post("/voice-jobs", async (req, res) => {
  const input = CreateVoiceJobBody.parse(req.body);
  if (!input.text.trim()) return res.status(400).json({ error: "Text is required for speech synthesis" });
  if (input.rate < 0.5 || input.rate > 2 || input.pitch < -8 || input.pitch > 8 || input.pauseMs < 0 || input.pauseMs > 1000) {
    return res.status(400).json({ error: "Voice controls are out of range" });
  }
  if (input.voiceProfileId) {
    const [profile] = await db.select().from(studioAssetsTable).where(and(eq(studioAssetsTable.id, input.voiceProfileId), eq(studioAssetsTable.kind, "voice-profile"))).limit(1);
    if (!profile || !profile.consentGranted) return res.status(400).json({ error: "The selected voice profile is unavailable or has no consent record" });
  }
  const [job] = await db.insert(studioJobsTable).values({
    kind: "voice",
    assetId: input.voiceProfileId ?? null,
    config: {
      text: input.text,
      pronunciation: input.pronunciation ?? "",
      rate: input.rate,
      pitch: input.pitch,
      pauseMs: input.pauseMs,
    },
  }).returning();
  await db.insert(activityTable).values({ kind: "render", title: "Voice synthesis queued", detail: `${input.text.slice(0, 80)}${input.text.length > 80 ? "…" : ""}` });
  return res.status(202).json(CreateVoiceJobResponse.parse(studioJobResponse(job)));
});

router.post("/image-jobs", async (req, res) => {
  const input = CreateImageJobBody.parse(req.body);
  const prompt = input.prompt.trim();
  if (prompt.length < 3) {
    return res.status(400).json({ error: "A descriptive image prompt is required" });
  }
  if (input.width % 64 !== 0 || input.height % 64 !== 0) {
    return res.status(400).json({ error: "Image dimensions must be multiples of 64" });
  }
  const [job] = await db.insert(studioJobsTable).values({
    kind: "image",
    config: {
      prompt,
      negativePrompt: input.negativePrompt?.trim() ?? "",
      width: input.width,
      height: input.height,
      steps: input.steps,
      guidance: input.guidance,
      seed: input.seed,
      requirements: imageRequirements,
      outputMetadata: null,
    },
  }).returning();
  await db.insert(activityTable).values({
    kind: "render",
    title: "Image generation queued",
    detail: `${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}`,
  });
  return res.status(202).json(CreateImageJobResponse.parse(studioJobResponse(job)));
});

router.post("/live-call/respond", async (req, res) => {
  const input = CreateLiveCallTurnBody.parse(req.body);
  const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:14b";
  const languageInstruction = input.language === "bn"
    ? "Reply naturally in Bangla."
    : input.language === "mixed"
      ? "Reply naturally in the same Bangla-English mix used by the caller."
      : "Reply naturally in English.";
  const startedAt = Date.now();
  let response: globalThis.Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "30m",
        messages: [
          {
            role: "system",
            content: `You are a concise, warm voice-call assistant running privately on the user's Mac. ${languageInstruction} Keep answers under 80 words unless the caller asks for detail.`,
          },
          ...input.history,
          { role: "user", content: input.transcript.trim() },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "connection failed";
    return res.status(503).json({
      error: `The local conversation model is unavailable at ${baseUrl}. Start Ollama with ${model} installed, then retry. ${detail}`,
    });
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    return res.status(503).json({ error: `Local Ollama returned ${response.status}: ${detail}` });
  }
  const payload = await response.json() as { message?: { content?: unknown } };
  const text = typeof payload.message?.content === "string" ? payload.message.content.trim() : "";
  if (!text) {
    return res.status(502).json({ error: "The local conversation model returned an empty response" });
  }
  return res.json(CreateLiveCallTurnResponse.parse({
    text,
    model,
    latencyMs: Date.now() - startedAt,
  }));
});

router.post("/presenter-jobs", async (req, res) => {
  const input = CreatePresenterJobBody.parse(req.body);
  const [asset] = await db.select().from(studioAssetsTable).where(and(eq(studioAssetsTable.id, input.assetId), eq(studioAssetsTable.kind, "presenter-reference"))).limit(1);
  if (!asset || !asset.consentGranted) return res.status(400).json({ error: "A consented presenter reference is required" });
  if (input.projectId) {
    const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, input.projectId)).limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });
  }
  if (!input.script.trim()) {
    return res.status(400).json({ error: "Presenter script is required" });
  }
  const framing = input.framing ?? (input.kind === "presenter-scene" ? "full-body" : "close-up");
  const deliveryMode = input.deliveryMode ?? "presentational";
  const durationSeconds = Math.max(1, Math.min(120, input.durationSeconds ?? 20));
  const [job] = await db.insert(studioJobsTable).values({
    kind: input.kind,
    assetId: input.assetId,
    projectId: input.projectId ?? null,
    config: {
      script: input.script,
      voiceJobId: input.voiceJobId ?? null,
      framing,
      deliveryMode,
      durationSeconds,
      requirements: presenterOutputContract,
      outputMetadata: null,
    },
  }).returning();
  await db.insert(activityTable).values({ kind: "render", title: input.kind === "presenter-lipsync" ? "Presenter lip-sync queued" : "Presenter scene queued", detail: `${asset.name} · local worker` });
  return res.status(202).json(CreatePresenterJobResponse.parse(studioJobResponse(job)));
});

router.post("/studio-jobs/:jobId/cancel", async (req, res) => {
  const { jobId } = CancelStudioJobParams.parse(req.params);
  const [job] = await db.update(studioJobsTable).set({ status: "cancelled", eta: null }).where(and(eq(studioJobsTable.id, jobId), sql`${studioJobsTable.status} in ('queued', 'rendering')`)).returning();
  if (!job) return res.status(404).json({ error: "Active studio job not found" });
  return res.json(CancelStudioJobResponse.parse(studioJobResponse(job)));
});

router.post("/studio-jobs/:jobId/retry", async (req, res) => {
  const { jobId } = RetryStudioJobParams.parse(req.params);
  const [existing] = await db.select().from(studioJobsTable).where(and(eq(studioJobsTable.id, jobId), sql`${studioJobsTable.status} in ('failed', 'cancelled')`)).limit(1);
  if (!existing) return res.status(404).json({ error: "Only failed or cancelled studio jobs can be retried" });
  const [job] = await db.update(studioJobsTable).set({
    status: "queued",
    progress: 0,
    eta: "waiting for worker",
    error: null,
    outputPath: null,
    startedAt: null,
    completedAt: null,
    config: { ...(existing.config ?? {}), generationQueued: false, commandId: null, outputMetadata: null },
  }).where(eq(studioJobsTable.id, jobId)).returning();
  if (!job) return res.status(404).json({ error: "Only failed or cancelled studio jobs can be retried" });
  return res.status(202).json(RetryStudioJobResponse.parse(studioJobResponse(job)));
});

router.post("/studio-jobs/:jobId/approve", async (req, res) => {
  const { jobId } = ApproveStudioJobParams.parse(req.params);
  const [job] = await db
    .update(studioJobsTable)
    .set({
      status: "complete",
      eta: null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(studioJobsTable.id, jobId),
        sql`${studioJobsTable.status} = 'review'`,
        sql`${studioJobsTable.kind} in ('presenter-lipsync', 'presenter-scene')`,
      ),
    )
    .returning();
  if (!job) {
    return res.status(409).json({
      error: "Only a generated presenter candidate awaiting director review can be approved.",
    });
  }
  return res.json(ApproveStudioJobResponse.parse(studioJobResponse(job)));
});

router.get("/render-jobs", async (_req, res) => {
  const rows = await db
    .select({
      job: renderJobsTable,
      projectName: projectsTable.name,
    })
    .from(renderJobsTable)
    .innerJoin(projectsTable, eq(renderJobsTable.projectId, projectsTable.id))
    .orderBy(desc(renderJobsTable.createdAt));
  return res.json(
    ListRenderJobsResponse.parse(
      rows.map(({ job, projectName }) => renderResponse(job, projectName)),
    ),
  );
});

router.post("/render-jobs", async (req, res) => {
  const input = CreateRenderJobBody.parse(req.body);
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.id, input.projectId),
        sql`${projectsTable.status} <> 'archived'`,
      ),
    )
    .limit(1);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  const [plan] = await db
    .select()
    .from(projectPlansTable)
    .where(eq(projectPlansTable.projectId, input.projectId))
    .limit(1);
  const scenes = plan?.scenes.map(normalizeScene) ?? [];
  const [job] = await db
    .insert(renderJobsTable)
    .values({
      projectId: input.projectId,
      preset: input.preset,
      options: {
        scenes,
        planUpdatedAt: plan?.updatedAt?.toISOString() ?? null,
      },
    })
    .returning();
  await db.insert(activityTable).values({
    kind: "render",
    title: "Render queued",
    detail: `${project.name} · ${input.preset} preset`,
  });
  return res.status(202).json(renderResponse(job, project.name));
});

router.post("/render-jobs/:jobId/cancel", async (req, res) => {
  const { jobId } = CancelRenderJobParams.parse(req.params);
  const [job] = await db
    .update(renderJobsTable)
    .set({ status: "cancelled", eta: null })
    .where(
      and(
        eq(renderJobsTable.id, jobId),
        sql`${renderJobsTable.status} in ('queued', 'rendering')`,
      ),
    )
    .returning();
  if (!job) {
    return res.status(404).json({ error: "Active render job not found" });
  }
  const [project] = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, job.projectId))
    .limit(1);
  return res.json(renderResponse(job, project?.name ?? "Unknown project"));
});

router.post("/render-jobs/:jobId/retry", async (req, res) => {
  const { jobId } = RetryRenderJobParams.parse(req.params);
  const [job] = await db.update(renderJobsTable).set({
    status: "queued",
    progress: 0,
    eta: "waiting for worker",
    error: null,
    outputPath: null,
    subtitlePath: null,
    startedAt: null,
    completedAt: null,
  }).where(and(eq(renderJobsTable.id, jobId), sql`${renderJobsTable.status} in ('failed', 'cancelled')`)).returning();
  if (!job) return res.status(404).json({ error: "Only failed or cancelled render jobs can be retried" });
  const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, job.projectId)).limit(1);
  return res.status(202).json(RetryRenderJobResponse.parse(renderResponse(job, project?.name ?? "Unknown project")));
});

export default router;