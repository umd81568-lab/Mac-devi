import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AudioWaveform,
  Check,
  Download,
  FileAudio,
  Film,
  ImagePlus,
  RefreshCw,
  SlidersHorizontal,
  UserRound,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import {
  useCancelRenderJob,
  useCancelStudioJob,
  useApproveStudioJob,
  useCreatePresenterJob,
  useCreateRenderJob,
  useCreateVoiceJob,
  useGetSystemReadiness,
  useImportStudioAsset,
  useListProjects,
  useListRenderJobs,
  useListStudioAssets,
  useListStudioJobs,
  useRetryRenderJob,
  useRetryStudioJob,
} from "@workspace/api-client-react";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, SectionLabel, StatusPill } from "@/components/studio-shell";

type AssetKind = "voice-profile" | "presenter-reference";
type StudioJob = {
  id: number;
  kind: "voice" | "presenter-lipsync" | "presenter-scene";
  assetId: number | null;
  status: string;
  progress: number;
  eta: string | null;
  outputPath: string | null;
  error: string | null;
  requirements: Record<string, unknown>;
  outputMetadata: Record<string, unknown> | null;
  createdAt: string;
};

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function JobCard({ job, onCancel, onRetry, onApprove }: { job: StudioJob; onCancel: () => void; onRetry: () => void; onApprove?: () => void }) {
  const label = job.kind === "voice" ? "Voice synthesis" : job.kind === "presenter-lipsync" ? "Presenter lip-sync" : "Presenter scene";
  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid={`row-studio-job-${job.id}`}>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          {job.kind === "voice" ? <AudioWaveform size={16} /> : <UserRound size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{label}</p>
            <StatusPill status={job.status} />
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            local worker · job {String(job.id).padStart(4, "0")}
          </p>
        </div>
      </div>
      {(job.status === "rendering" || job.status === "queued") && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} /></div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground"><span>{job.progress}% complete</span><span>{job.eta ?? "worker starting"}</span></div>
        </div>
      )}
      {job.error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-red-200">{job.error}</p>}
      {job.kind !== "voice" && <div className="mt-3 rounded-md border border-border bg-background/60 px-3 py-2 text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">Output contract:</span> {String(job.requirements?.output ?? "Moving human presenter MP4")} {Boolean(job.outputMetadata?.verified) && <span className="ml-2 text-accent">· technical media checks passed</span>}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {job.outputPath && <a href={job.outputPath} download className="inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/20"><Download size={14} /> {job.kind === "voice" ? "Download WAV" : job.status === "review" ? "Open candidate video" : "Download presenter video"}</a>}
        {job.status === "review" && onApprove && <Button onClick={onApprove} data-testid={`button-approve-presenter-${job.id}`}><Check size={14} /> Approve after review</Button>}
        {(job.status === "queued" || job.status === "rendering") && <Button variant="ghost" onClick={onCancel} data-testid={`button-cancel-studio-job-${job.id}`}><X size={14} /> Cancel</Button>}
        {(job.status === "failed" || job.status === "cancelled") && <Button variant="secondary" onClick={onRetry} data-testid={`button-retry-studio-job-${job.id}`}><RefreshCw size={14} /> Retry</Button>}
      </div>
    </div>
  );
}

function AssetImport({ kind, onImported }: { kind: AssetKind; onImported: () => void }) {
  const importAsset = useImportStudioAsset();
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState("");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [consent, setConsent] = useState(false);
  const isVoice = kind === "voice-profile";
  const selectFile = async (candidate: File | undefined) => {
    if (!candidate) return;
    setFile(candidate);
    setName(candidate.name.replace(/\.[^.]+$/, ""));
    setData(await fileAsBase64(candidate));
  };
  const submit = () => {
    if (!file || !data || !name.trim() || !subject.trim() || !consent) return;
    importAsset.mutate({
     data: { kind, name: name.trim(), mimeType: file.type || (isVoice ? "audio/wav" : "image/png"), data, consentGranted: true, consentSubject: subject.trim(), ...(isVoice ? {} : { referenceType: "real-human" as const }) },
    }, { onSuccess: onImported });
  };
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <SectionLabel>{isVoice ? "Import a consented voice profile" : "Import a consented presenter reference"}</SectionLabel>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">Files are copied into the private local worker directory. Only the generated output link is exposed to this workspace.</p>
      <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-background px-4 py-4 hover:border-primary/50">
        {isVoice ? <FileAudio size={18} className="text-primary" /> : <ImagePlus size={18} className="text-primary" />}
        <span className="min-w-0 flex-1 text-xs">{file ? file.name : isVoice ? "Choose a WAV, MP3, or M4A sample" : "Choose an image or reference video"}</span>
        <Upload size={15} className="text-muted-foreground" />
        <input type="file" className="hidden" accept={isVoice ? "audio/*" : "image/*,video/*"} onChange={(event) => void selectFile(event.target.files?.[0])} data-testid={`input-upload-${kind}`} />
      </label>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Asset name" className="h-10 rounded-md border border-input bg-background px-3 text-sm" data-testid={`input-${kind}-name`} />
        <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Consent recorded for" className="h-10 rounded-md border border-input bg-background px-3 text-sm" data-testid={`input-${kind}-subject`} />
      </div>
      <label className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 accent-primary" data-testid={`checkbox-consent-${kind}`} />
        I confirm I have permission from this person to use this voice or likeness for generated media.
      </label>
      <Button className="mt-4" onClick={submit} disabled={!file || !data || !name.trim() || !subject.trim() || !consent || importAsset.isPending} data-testid={`button-import-${kind}`}>
        {importAsset.isPending ? "Securing local copy…" : "Import securely"}
      </Button>
    </div>
  );
}

export function VoicePage() {
  const queryClient = useQueryClient();
  const assets = useListStudioAssets({ query: { queryKey: ["/api/assets"], refetchInterval: 2000 } });
  const jobs = useListStudioJobs({ query: { queryKey: ["/api/studio-jobs"], refetchInterval: 1000 } });
  const create = useCreateVoiceJob();
  const cancel = useCancelStudioJob();
  const retry = useRetryStudioJob();
  const [text, setText] = useState("The next chapter starts here.");
  const [profileId, setProfileId] = useState("");
  const [pronunciation, setPronunciation] = useState("");
  const [rate, setRate] = useState("1");
  const [pitch, setPitch] = useState("0");
  const [pauseMs, setPauseMs] = useState("100");
  const voiceProfiles = (assets.data ?? []).filter((asset) => asset.kind === "voice-profile");
  const voiceJobs = (jobs.data ?? []).filter((job) => job.kind === "voice") as StudioJob[];
  const refresh = () => { void queryClient.invalidateQueries(); };
  const submit = () => create.mutate({
    data: { text, voiceProfileId: profileId ? Number(profileId) : null, pronunciation: pronunciation || null, rate: Number(rate), pitch: Number(pitch), pauseMs: Number(pauseMs) },
  }, { onSuccess: refresh });
  return (
    <>
      <PageHeader eyebrow="04 / voice workspace" title="Voice" description="Build a repeatable vocal chain. Profiles, pronunciation, and timing stay explicit." action={<div className="flex items-center gap-2 rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent"><LockIcon /> Local-only assets</div>} />
      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <div className="space-y-6">
          <AssetImport kind="voice-profile" onImported={refresh} />
          <div className="rounded-lg border border-border bg-card p-5">
            <SectionLabel right={<span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">WAV output · local worker</span>}>Synthesize a take</SectionLabel>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} className="w-full resize-none rounded-md border border-input bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary/60" placeholder="Write the narration to synthesize…" data-testid="textarea-voice-script" />
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <select value={profileId} onChange={(event) => setProfileId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-voice-profile">
                <option value="">Neutral local voice</option>{voiceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <input value={pronunciation} onChange={(event) => setPronunciation(event.target.value)} placeholder="Pronunciation notes (optional)" className="h-10 rounded-md border border-input bg-background px-3 text-sm" data-testid="input-pronunciation" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rate<input type="number" min="0.5" max="2" step="0.05" value={rate} onChange={(event) => setRate(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-sans normal-case tracking-normal text-foreground" data-testid="input-voice-rate" /></label>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Pitch<input type="number" min="-8" max="8" step="1" value={pitch} onChange={(event) => setPitch(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-sans normal-case tracking-normal text-foreground" data-testid="input-voice-pitch" /></label>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Pause ms<input type="number" min="0" max="1000" step="10" value={pauseMs} onChange={(event) => setPauseMs(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-sans normal-case tracking-normal text-foreground" data-testid="input-voice-pause" /></label>
            </div>
            <Button className="mt-5" onClick={submit} disabled={!text.trim() || create.isPending} data-testid="button-synthesize-voice"><Volume2 size={15} /> {create.isPending ? "Queueing take…" : "Generate WAV take"}</Button>
          </div>
        </div>
        <div>
          <SectionLabel right={<span className="font-normal normal-case tracking-normal text-muted-foreground">{voiceJobs.length} local takes</span>}>Voice jobs</SectionLabel>
          {jobs.isLoading ? <LoadingState rows={3} /> : jobs.isError ? <ErrorState retry={jobs.refetch} /> : voiceJobs.length ? <div className="space-y-3">{voiceJobs.map((job) => <JobCard key={job.id} job={job} onCancel={() => cancel.mutate({ jobId: job.id }, { onSuccess: refresh })} onRetry={() => retry.mutate({ jobId: job.id }, { onSuccess: refresh })} />)}</div> : <EmptyState title="No takes yet" detail="Generate a local WAV take to see progress and download the finished audio here." />}
        </div>
      </div>
    </>
  );
}

function LockIcon() {
  return <span className="grid h-4 w-4 place-items-center rounded-full border border-accent/50 text-[9px]">✓</span>;
}

export function AvatarPage() {
  const queryClient = useQueryClient();
  const assets = useListStudioAssets({ query: { queryKey: ["/api/assets"], refetchInterval: 2000 } });
  const jobs = useListStudioJobs({ query: { queryKey: ["/api/studio-jobs"], refetchInterval: 1000 } });
  const projects = useListProjects();
  const create = useCreatePresenterJob();
  const approve = useApproveStudioJob();
  const cancel = useCancelStudioJob();
  const retry = useRetryStudioJob();
  const readiness = useGetSystemReadiness({ query: { queryKey: ["/api/system/readiness"], refetchInterval: 3000 } });
  const [assetId, setAssetId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState<"presenter-lipsync" | "presenter-scene">("presenter-lipsync");
  const [script, setScript] = useState("Welcome to the production desk. This scene is delivered by the local presenter worker.");
  const [framing, setFraming] = useState<"close-up" | "waist-up" | "full-body">("full-body");
  const [deliveryMode, setDeliveryMode] = useState<"conversational" | "presentational" | "energetic" | "calm">("presentational");
  const [durationSeconds, setDurationSeconds] = useState("20");
  const presenterAssets = (assets.data ?? []).filter((asset) => asset.kind === "presenter-reference");
  const presenterJobs = (jobs.data ?? []).filter((job) => job.kind !== "voice") as StudioJob[];
  const refresh = () => { void queryClient.invalidateQueries(); };
  const submit = () => {
    if (!assetId || !script.trim()) return;
    create.mutate({ data: { kind, assetId: Number(assetId), projectId: projectId ? Number(projectId) : null, script, voiceJobId: null, framing, deliveryMode, durationSeconds: Number(durationSeconds) } }, { onSuccess: refresh });
  };
  return (
    <>
      <PageHeader eyebrow="05 / presenter workspace" title="Human presenters" description="Reference upload, consent, lip-sync, scene delivery, and preview all run through the local worker." action={<Link href="/render" className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3.5 py-2.5 text-xs font-semibold hover:bg-muted"><Film size={15} /> Open render center</Link>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_.9fr]">
        <div className="space-y-6">
          <AssetImport kind="presenter-reference" onImported={refresh} />
          <div className={`rounded-lg border p-4 ${readiness.data?.presenterReady ? "border-accent/25 bg-accent/5" : "border-amber-300/25 bg-amber-300/[.06]"}`} data-testid="status-presenter-readiness">
            <div className="flex items-start gap-3"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${readiness.data?.presenterReady ? "bg-accent" : "bg-amber-300"}`} /><div><p className="text-xs font-semibold">{readiness.data?.presenterReady ? "Human presenter pipeline ready" : "Presenter generation blocked"}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{readiness.isLoading ? "Checking the signed Mac worker…" : readiness.data?.presenterBlockReason ?? "The signed Mac worker can generate and verify local human performances."}</p><p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{readiness.data?.presenterModel ?? "MLX human performance pipeline"} · local-only · no still fallback</p></div></div>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <SectionLabel>Deliver a presenter scene</SectionLabel>
            <div className="grid gap-3 md:grid-cols-2">
              <select value={assetId} onChange={(event) => setAssetId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-presenter-reference"><option value="">Select a consented reference</option>{presenterAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-presenter-project"><option value="">Standalone preview</option>{(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
            </div>
             <div className="mt-3 flex gap-2"><button onClick={() => setKind("presenter-lipsync")} className={`rounded-md border px-3 py-2 text-xs font-semibold ${kind === "presenter-lipsync" ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`} data-testid="button-mode-lipsync">Lip-sync preview</button><button onClick={() => setKind("presenter-scene")} className={`rounded-md border px-3 py-2 text-xs font-semibold ${kind === "presenter-scene" ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`} data-testid="button-mode-scene">Scene delivery</button></div>
             <div className="mt-3 grid gap-3 md:grid-cols-3">
               <label className="text-xs font-semibold">Framing<select value={framing} onChange={(event) => setFraming(event.target.value as typeof framing)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-presenter-framing"><option value="close-up">Close-up</option><option value="waist-up">Waist-up</option><option value="full-body">Full body</option></select></label>
               <label className="text-xs font-semibold">Delivery mode<select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as typeof deliveryMode)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-presenter-delivery-mode"><option value="conversational">Conversational</option><option value="presentational">Presentational</option><option value="energetic">Energetic</option><option value="calm">Calm</option></select></label>
               <label className="text-xs font-semibold">Timing (seconds)<input type="number" min="1" max="120" step="1" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="input-presenter-duration" /></label>
             </div>
            <textarea value={script} onChange={(event) => setScript(event.target.value)} rows={4} className="mt-3 w-full resize-none rounded-md border border-input bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary/60" data-testid="textarea-presenter-script" />
             <Button className="mt-4" onClick={submit} disabled={!assetId || !script.trim() || !readiness.data?.presenterReady || create.isPending} data-testid="button-generate-presenter"><UserRound size={15} /> {create.isPending ? "Queueing delivery…" : readiness.data?.presenterReady ? "Generate moving presenter" : "Connect presenter pipeline first"}</Button>
             {create.isError && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-red-200">Presenter job could not be queued. Confirm the signed Mac worker and the local human presenter pipeline are ready.</p>}
          </div>
        </div>
        <div><SectionLabel right={<span className="font-normal normal-case tracking-normal text-muted-foreground">{presenterJobs.length} deliveries</span>}>Presenter jobs</SectionLabel>{jobs.isLoading ? <LoadingState rows={3} /> : jobs.isError ? <ErrorState retry={jobs.refetch} /> : presenterJobs.length ? <div className="space-y-3">{presenterJobs.map((job) => <JobCard key={job.id} job={job} onCancel={() => cancel.mutate({ jobId: job.id }, { onSuccess: refresh })} onRetry={() => retry.mutate({ jobId: job.id }, { onSuccess: refresh })} onApprove={() => approve.mutate({ jobId: job.id }, { onSuccess: refresh })} />)}</div> : <EmptyState title="No presenter deliveries yet" detail="Import a consented reference and queue a lip-sync or scene delivery." />}</div>
      </div>
    </>
  );
}

export function RenderPage() {
  const queryClient = useQueryClient();
  const jobs = useListRenderJobs({ query: { queryKey: ["/api/render-jobs"], refetchInterval: 1000 } });
  const projects = useListProjects();
  const create = useCreateRenderJob();
  const cancel = useCancelRenderJob();
  const retry = useRetryRenderJob();
  const [projectId, setProjectId] = useState("");
  const [preset, setPreset] = useState("preview");
  const submit = () => { if (projectId) create.mutate({ data: { projectId: Number(projectId), preset: preset as "preview" | "youtube" | "shorts" | "reels" | "master" } }, { onSuccess: () => void queryClient.invalidateQueries() }); };
  return (
    <>
      <PageHeader eyebrow="06 / render center" title="Render queue" description="Render real preview and final video files with subtitles, mixed audio, progress, cancellation, and recovery actions." action={<Button onClick={submit} disabled={!projectId || create.isPending} data-testid="button-queue-render"><Film size={15} /> Queue render</Button>} />
      <div className="mb-7 grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-[1fr_220px_auto]">
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-render-project"><option value="">Select a project to render</option>{(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        <select value={preset} onChange={(event) => setPreset(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-render-preset"><option value="preview">Preview · fast</option><option value="youtube">YouTube · 1080p</option><option value="shorts">Shorts · 9:16</option><option value="reels">Reels · 9:16</option><option value="master">Master · highest quality</option></select>
        <Button onClick={submit} disabled={!projectId || create.isPending} data-testid="button-submit-render">{create.isPending ? "Queueing…" : "Add to queue"}</Button>
      </div>
      {jobs.isLoading ? <LoadingState /> : jobs.isError ? <ErrorState retry={jobs.refetch} /> : jobs.data?.length ? <div className="space-y-3">{jobs.data.map((job) => <div key={job.id} className="rounded-lg border border-border bg-card p-5" data-testid={`row-render-job-${job.id}`}><div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div className="flex min-w-0 items-center gap-4"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${job.status === "rendering" ? "bg-primary/10 text-primary" : job.status === "complete" ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}><Film size={17} /></div><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{job.projectName}</h3><p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{job.preset} · job {String(job.id).padStart(4, "0")}</p></div></div><div className="flex items-center gap-4"><div className="text-right"><StatusPill status={job.status} />{job.eta && <p className="mt-2 font-mono text-[10px] text-muted-foreground">{job.eta} remaining</p>}</div>{job.status === "queued" || job.status === "rendering" ? <Button variant="ghost" onClick={() => cancel.mutate({ jobId: job.id }, { onSuccess: () => void queryClient.invalidateQueries() })} data-testid={`button-cancel-render-${job.id}`}><X size={15} /> Cancel</Button> : job.status === "failed" || job.status === "cancelled" ? <Button variant="secondary" onClick={() => retry.mutate({ jobId: job.id }, { onSuccess: () => void queryClient.invalidateQueries() })} data-testid={`button-retry-render-${job.id}`}><RefreshCw size={14} /> Retry</Button> : null}</div></div>{(job.status === "rendering" || job.status === "queued") && <div className="mt-4"><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} /></div><div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground"><span>{job.progress}% complete</span><span>worker progress</span></div></div>}{job.error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-red-200">{job.error}</p>}{job.outputPath && <div className="mt-4 flex flex-wrap gap-2"><a href={job.outputPath} download className="inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/20"><Download size={14} /> Download video</a>{job.subtitlePath && <a href={job.subtitlePath} download className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"><SlidersHorizontal size={14} /> Subtitles (.srt)</a>}</div>}</div>)}</div> : <EmptyState title="Render queue is clear" detail="Choose a project and preset above when you are ready to stage delivery." />}
    </>
  );
}