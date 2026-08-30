import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const WORKER_TTL_MS = 45 * 1000;

export type BridgeCheckStatus = "pass" | "warning" | "action";
export type InstallStatus =
  | "pending-approval"
  | "approved"
  | "queued"
  | "downloading"
  | "installing"
  | "complete"
  | "failed";

export interface WorkerReport {
  workerId: string;
  protocolVersion: string;
  workerVersion: string;
  deviceName: string;
  chip: string;
  memoryGb: number;
  metal: boolean;
  mps: boolean;
  mlx: boolean;
  diskFreeGb: number;
  diskTotalGb: number;
  runtime: string;
  permissions: Record<string, boolean>;
  presenterPipeline?: boolean;
  presenterModel?: string;
  imagePipeline?: boolean;
  imageModel?: string;
}

export interface InstallJob {
  id: string;
  modelId: number;
  modelName: string;
  status: InstallStatus;
  progress: number;
  logs: string[];
  error: string | null;
  canRetry: boolean;
  requestedAt: string;
  updatedAt: string;
}

export interface BridgeCommand {
  id: string;
  kind: "install-model" | "store-huggingface-credential" | "generate-presenter" | "generate-image";
  jobId: string | null;
  modelId: number | null;
  modelName: string | null;
  providerId: number | null;
  requestId: string | null;
  studioJobId: number | null;
  sourceFile: string | null;
  audioFile: string | null;
  script: string | null;
  presenterMode: string | null;
  framing: string | null;
  deliveryMode: string | null;
  durationSeconds: number | null;
  referenceSha256: string | null;
  audioSha256: string | null;
  prompt?: string | null;
  negativePrompt?: string | null;
  width?: number | null;
  height?: number | null;
  steps?: number | null;
  guidance?: number | null;
  seed?: number | null;
}

export const presenterRequirements = {
  pipeline: "local-human-presenter-v1",
  model: "MLX human performance pipeline",
  runtime: "Apple Silicon + Metal/MPS + Python/MLX",
  output: "MP4 video with speech-synchronized mouth, face, head, torso, and full-body motion",
  localOnly: true,
} as const;

export const imageRequirements = {
  pipeline: "local-flux-image-v1",
  model: "FLUX.1 Schnell · MLX",
  runtime: "Apple Silicon + Metal/MPS + Python/MLX",
  output: "PNG image generated from the approved text prompt",
  localOnly: true,
} as const;

export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

interface WorkerState {
  secret: string;
  report: WorkerReport;
  connectedAt: string;
  lastSeenAt: string;
  usedNonces: Set<string>;
}

interface PairingState {
  code: string;
  hash: string;
  expiresAt: number;
}

interface CredentialRequest {
  requestId: string;
  providerId: number;
  status: "pending" | "stored" | "failed";
  detail: string;
}

const workers = new Map<string, WorkerState>();
const commands = new Map<string, BridgeCommand>();
const installJobs = new Map<string, InstallJob>();
const credentialRequests = new Map<string, CredentialRequest>();
let pairing: PairingState | null = null;

function now() {
  return new Date().toISOString();
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function hashBridgeBody(value: unknown) {
  if (value === undefined) return hash("");
  return hash(canonicalJson(value));
}

export function signNonce(secret: string, nonce: string, method = "POST", route = "/", body?: unknown) {
  const signingInput = `${method.toUpperCase()}\n${route}\n${nonce}\n${hashBridgeBody(body)}`;
  return createHmac("sha256", secret).update(signingInput).digest("hex");
}

function isSignatureValid(
  secret: string,
  nonce: string,
  signature: string,
  method: string,
  route: string,
  body: unknown,
) {
  const expected = Buffer.from(signNonce(secret, nonce, method, route, body), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function connected(worker: WorkerState) {
  return Date.now() - Date.parse(worker.lastSeenAt) <= WORKER_TTL_MS;
}

function activeWorker() {
  return [...workers.values()].find(connected) ?? null;
}

function workerChecks(report: WorkerReport): Array<{ name: string; detail: string; status: BridgeCheckStatus }> {
  const permissionEntries = Object.entries(report.permissions);
  return [
    {
      name: "Desktop bridge",
      detail: `${report.deviceName} · signed worker ${report.workerVersion}`,
      status: "pass",
    },
    {
      name: "Apple Silicon",
      detail: report.chip,
      status: report.chip.toLowerCase().includes("apple") || report.chip.toLowerCase().includes("arm") ? "pass" : "warning",
    },
    {
      name: "Metal / MPS",
      detail: `${report.metal ? "Metal available" : "Metal unavailable"} · ${report.mps ? "MPS available" : "MPS unavailable"}`,
      status: report.metal && report.mps ? "pass" : "warning",
    },
    {
      name: "MLX runtime",
      detail: report.mlx ? `${report.runtime} is ready for local inference.` : "MLX is not available on this worker.",
      status: report.mlx ? "pass" : "warning",
    },
    {
      name: "Disk space",
      detail: `${report.diskFreeGb.toFixed(1)} GB free of ${report.diskTotalGb.toFixed(1)} GB`,
      status: report.diskFreeGb >= 10 ? "pass" : "action",
    },
    {
      name: "Runtime",
      detail: report.runtime || "Runtime was not reported by the worker.",
      status: report.runtime ? "pass" : "action",
    },
    ...permissionEntries.map(([name, allowed]) => ({
      name: `Permission · ${name}`,
      detail: allowed ? "Granted to the local worker." : "Grant this permission in macOS System Settings.",
      status: allowed ? ("pass" as const) : ("action" as const),
    })),
    {
      name: "Human presenter pipeline",
      detail: report.presenterPipeline
        ? `${report.presenterModel ?? presenterRequirements.model} is ready for local performance generation.`
        : "Install the local human presenter pipeline; no static-image fallback is allowed.",
      status: report.presenterPipeline ? ("pass" as const) : ("action" as const),
    },
    {
      name: "Image generation pipeline",
      detail: report.imagePipeline
        ? `${report.imageModel ?? imageRequirements.model} is ready for local image generation.`
        : "Install the local FLUX/MLX image pipeline before generating images.",
      status: report.imagePipeline ? ("pass" as const) : ("action" as const),
    },
  ];
}

export function readinessReport() {
  const worker = activeWorker();
  if (!worker) {
    return {
      status: "offline" as const,
      deviceName: "Desktop bridge not connected",
      chip: "Awaiting Apple Silicon scan",
      memory: "Worker memory unavailable",
      accelerator: "Metal / MPS scan pending",
      agent: "Phi-3 setup agent · not connected",
      lastScanAt: null,
      checks: [
        { name: "Desktop bridge", detail: "Generate a pairing code, then start the signed Mac worker.", status: "action" as const },
        { name: "API workspace", detail: "Project and queue services are responding.", status: "pass" as const },
        { name: "Model runtime", detail: "Waiting for the local MLX/Metal runtime handshake.", status: "warning" as const },
      ],
      bridgeConnected: false,
      bridgeId: null,
      disk: "Worker disk unavailable",
      runtime: "Worker runtime unavailable",
      metal: "Unknown",
      mps: "Unknown",
      mlx: "Unknown",
      lastSeenAt: null,
      workerVersion: null,
        presenterReady: false,
        presenterModel: presenterRequirements.model,
        presenterBlockReason: "Connect a signed Apple Silicon Mac worker with the local human presenter pipeline installed.",
        imageReady: false,
        imageModel: imageRequirements.model,
        imageBlockReason: "Connect a signed Apple Silicon Mac worker with the local FLUX/MLX image pipeline installed.",
    };
  }

  const checks = workerChecks(worker.report);
  const status = checks.every((check) => check.status === "pass") ? "ready" : "attention";
  return {
    status: status as "ready" | "attention",
    deviceName: worker.report.deviceName,
    chip: worker.report.chip,
    memory: `${worker.report.memoryGb.toFixed(0)} GB unified memory`,
    accelerator: `${worker.report.metal ? "Metal" : "Metal unavailable"} · ${worker.report.mps ? "MPS" : "MPS unavailable"} · ${worker.report.mlx ? "MLX" : "MLX unavailable"}`,
    agent: `Phi-3 setup agent · ${worker.report.runtime}`,
    lastScanAt: worker.lastSeenAt,
    checks,
    bridgeConnected: true,
    bridgeId: worker.report.workerId,
    disk: `${worker.report.diskFreeGb.toFixed(1)} GB free / ${worker.report.diskTotalGb.toFixed(1)} GB`,
    runtime: worker.report.runtime,
    metal: worker.report.metal ? "Available" : "Unavailable",
    mps: worker.report.mps ? "Available" : "Unavailable",
    mlx: worker.report.mlx ? "Available" : "Unavailable",
    lastSeenAt: worker.lastSeenAt,
    workerVersion: worker.report.workerVersion,
    presenterReady: worker.report.presenterPipeline === true
      && worker.report.metal
      && worker.report.mps
      && worker.report.mlx,
    presenterModel: worker.report.presenterModel ?? presenterRequirements.model,
    presenterBlockReason: worker.report.presenterPipeline === true
      && worker.report.metal
      && worker.report.mps
      && worker.report.mlx
      ? null
      : "Install and expose the local human presenter pipeline on the signed Mac worker. Static image wrapping is disabled.",
    imageReady: worker.report.imagePipeline === true
      && worker.report.metal
      && worker.report.mps
      && worker.report.mlx,
    imageModel: worker.report.imageModel ?? imageRequirements.model,
    imageBlockReason: worker.report.imagePipeline === true
      && worker.report.metal
      && worker.report.mps
      && worker.report.mlx
      ? null
      : "Install and expose the local FLUX/MLX image pipeline on the signed Mac worker.",
  };
}

export function createPairing() {
  const code = randomBytes(18).toString("base64url");
  pairing = { code, hash: hash(code), expiresAt: Date.now() + PAIRING_TTL_MS };
  return { pairingCode: code, expiresAt: new Date(pairing.expiresAt).toISOString() };
}

function authenticate(
  workerId: string,
  nonce: string,
  signature: string,
  method: string,
  route: string,
  body: unknown,
  pairingCode?: string,
) {
  if (!nonce || !signature || nonce.length < 16) {
    throw new BridgeError("A nonce and signature are required.", 401);
  }
  let worker = workers.get(workerId);
  if (!worker) {
    if (!pairing || pairing.expiresAt < Date.now() || !pairingCode || hash(pairingCode) !== pairing.hash) {
      throw new BridgeError("This worker is not paired. Generate a new pairing code in Studio.", 401);
    }
    // A pairing code authorizes the current Mac only. Do not let a stale
    // worker continue to receive commands after the user pairs a replacement.
    for (const existingWorkerId of workers.keys()) {
      if (existingWorkerId !== workerId) workers.delete(existingWorkerId);
    }
    worker = {
      secret: pairingCode,
      report: {} as WorkerReport,
      connectedAt: now(),
      lastSeenAt: now(),
      usedNonces: new Set(),
    };
    workers.set(workerId, worker);
    pairing = null;
  }
  if (worker.usedNonces.has(nonce) || !isSignatureValid(worker.secret, nonce, signature, method, route, body)) {
    throw new BridgeError("Bridge signature could not be verified.", 401);
  }
  worker.usedNonces.add(nonce);
  if (worker.usedNonces.size > 100) worker.usedNonces.delete(worker.usedNonces.values().next().value as string);
  worker.lastSeenAt = now();
  return worker;
}

export function authenticateWorker(workerId: string, nonce: string, signature: string, method: string, route: string, body: unknown) {
  authenticate(workerId, nonce, signature, method, route, body);
}

export function bridgeHandshake(
  report: WorkerReport,
  pairingCode: string | undefined,
  nonce: string,
  signature: string,
  body: unknown,
) {
  const worker = authenticate(report.workerId, nonce, signature, "POST", "/system/bridge/handshake", body, pairingCode);
  worker.report = report;
  worker.lastSeenAt = now();
  return readinessReport();
}

export function bridgeHeartbeat(workerId: string, nonce: string, signature: string, body: unknown) {
  authenticate(workerId, nonce, signature, "POST", "/system/bridge/heartbeat", body);
  return readinessReport();
}

export function requireConnected() {
  if (!activeWorker()) throw new BridgeError("Connect the signed Mac worker before continuing.", 409);
  return activeWorker()!;
}

export function listCommands() {
  return [...commands.values()];
}

export function queuePresenter(input: {
  studioJobId: number;
  sourceFile: string;
  audioFile: string;
  script: string;
  presenterMode: "presenter-lipsync" | "presenter-scene";
  framing: "close-up" | "waist-up" | "full-body";
  deliveryMode: "conversational" | "presentational" | "energetic" | "calm";
  durationSeconds: number;
  referenceSha256: string;
  audioSha256: string;
}) {
  const worker = requireConnected();
  if (!worker.report.presenterPipeline || !worker.report.metal || !worker.report.mps || !worker.report.mlx) {
    throw new BridgeError(
      "Presenter generation is blocked: the signed Mac worker is missing the local MLX human presenter pipeline. Install it and reconnect the worker; static-image wrapping is disabled.",
      409,
    );
  }
  const commandId = randomUUID();
  commands.set(commandId, {
    id: commandId,
    kind: "generate-presenter",
    jobId: null,
    modelId: null,
    modelName: worker.report.presenterModel ?? presenterRequirements.model,
    providerId: null,
    requestId: null,
    studioJobId: input.studioJobId,
    sourceFile: input.sourceFile,
    audioFile: input.audioFile,
    script: input.script,
    presenterMode: input.presenterMode,
    framing: input.framing,
    deliveryMode: input.deliveryMode,
    durationSeconds: input.durationSeconds,
    referenceSha256: input.referenceSha256,
    audioSha256: input.audioSha256,
  });
  return commandId;
}

export function queueImage(input: {
  studioJobId: number;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  guidance: number;
  seed: number;
}) {
  const worker = requireConnected();
  if (!worker.report.imagePipeline || !worker.report.metal || !worker.report.mps || !worker.report.mlx) {
    throw new BridgeError(
      "Image generation is blocked: the signed Mac worker is missing the local FLUX/MLX image pipeline.",
      409,
    );
  }
  const commandId = randomUUID();
  commands.set(commandId, {
    id: commandId,
    kind: "generate-image",
    jobId: null,
    modelId: null,
    modelName: worker.report.imageModel ?? imageRequirements.model,
    providerId: null,
    requestId: null,
    studioJobId: input.studioJobId,
    sourceFile: null,
    audioFile: null,
    script: null,
    presenterMode: null,
    framing: null,
    deliveryMode: null,
    durationSeconds: null,
    referenceSha256: null,
    audioSha256: null,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    width: input.width,
    height: input.height,
    steps: input.steps,
    guidance: input.guidance,
    seed: input.seed,
  });
  return commandId;
}

export function acknowledgeCommand(commandId: string) {
  commands.delete(commandId);
}

export function createInstall(modelId: number, modelName: string) {
  const timestamp = now();
  const job: InstallJob = {
    id: randomUUID(),
    modelId,
    modelName,
    status: "pending-approval",
    progress: 0,
    logs: ["Waiting for approval before downloading model files."],
    error: null,
    canRetry: false,
    requestedAt: timestamp,
    updatedAt: timestamp,
  };
  installJobs.set(job.id, job);
  return job;
}

export function getInstall(modelId: number) {
  return [...installJobs.values()].find((job) => job.modelId === modelId) ?? null;
}

function queueInstall(job: InstallJob) {
  const timestamp = now();
  job.status = "approved";
  job.progress = 0;
  job.error = null;
  job.canRetry = false;
  job.updatedAt = timestamp;
  job.logs = [...job.logs, "Approved. Waiting for the Mac worker to begin setup."];
  const commandId = randomUUID();
  commands.set(commandId, {
    id: commandId,
    kind: "install-model",
    jobId: job.id,
    modelId: job.modelId,
    modelName: job.modelName,
    providerId: null,
    requestId: null,
    studioJobId: null,
    sourceFile: null,
    audioFile: null,
    script: null,
    presenterMode: null,
    framing: null,
    deliveryMode: null,
    durationSeconds: null,
    referenceSha256: null,
    audioSha256: null,
  });
  return job;
}

export function approveInstall(modelId: number) {
  requireConnected();
  const job = getInstall(modelId);
  if (!job) throw new BridgeError("No installation request exists for this model.", 404);
  if (job.status !== "pending-approval") throw new BridgeError("This installation is no longer awaiting approval.", 409);
  return queueInstall(job);
}

export function retryInstall(modelId: number) {
  requireConnected();
  const job = getInstall(modelId);
  if (!job) throw new BridgeError("No installation request exists for this model.", 404);
  if (job.status !== "failed") throw new BridgeError("Only failed installations can be retried.", 409);
  return queueInstall(job);
}

export function updateInstall(jobId: string, status: InstallStatus, progress: number, message: string, error?: string) {
  const job = installJobs.get(jobId);
  if (!job) throw new BridgeError("Installation job not found.", 404);
  if (job.status === "pending-approval") {
    throw new BridgeError("This installation must be approved before the worker can report progress.", 409);
  }
  job.status = status;
  job.progress = progress;
  job.error = status === "failed" ? error ?? message : null;
  job.canRetry = status === "failed";
  job.updatedAt = now();
  job.logs = [...job.logs, message].slice(-40);
  return job;
}

export function createCredentialRequest(providerId: number) {
  requireConnected();
  const request: CredentialRequest = {
    requestId: randomUUID(),
    providerId,
    status: "pending",
    detail: "The Mac worker will collect this credential and store it in macOS Keychain.",
  };
  credentialRequests.set(request.requestId, request);
  const commandId = randomUUID();
  commands.set(commandId, {
    id: commandId,
    kind: "store-huggingface-credential",
    jobId: null,
    modelId: null,
    modelName: null,
    providerId,
    requestId: request.requestId,
    studioJobId: null,
    sourceFile: null,
    audioFile: null,
    script: null,
    presenterMode: null,
    framing: null,
    deliveryMode: null,
    durationSeconds: null,
    referenceSha256: null,
    audioSha256: null,
  });
  return request;
}

export function getCredentialRequest(requestId: string) {
  return credentialRequests.get(requestId);
}

export function updateCredentialRequest(requestId: string, stored: boolean, detail: string) {
  const request = credentialRequests.get(requestId);
  if (!request) throw new BridgeError("Credential request not found.", 404);
  request.status = stored ? "stored" : "failed";
  request.detail = stored ? "Credential stored in macOS Keychain. The token never entered project data." : detail;
  return request;
}