import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCancelStudioJob,
  useCreateImageJob,
  useCreateLiveCallTurn,
  useCreateVoiceJob,
  useGetSystemReadiness,
  useListStudioAssets,
  useListStudioJobs,
  useRetryStudioJob,
} from "@workspace/api-client-react";
import {
  Download,
  Image as ImageIcon,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  Send,
  Sparkles,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, SectionLabel, StatusPill } from "@/components/studio-shell";

type StudioJob = {
  id: number;
  kind: "voice" | "image" | "presenter-lipsync" | "presenter-scene";
  status: string;
  progress: number;
  eta: string | null;
  outputPath: string | null;
  error: string | null;
  outputMetadata: Record<string, unknown> | null;
  createdAt: string;
};

type SpeechRecognitionResultEventLike = {
  results: ArrayLike<{ 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function localError(error: unknown) {
  return String((error as { message?: string } | null)?.message ?? "The local runtime could not complete this request.");
}

export function ImagePage() {
  const queryClient = useQueryClient();
  const readiness = useGetSystemReadiness({ query: { queryKey: ["/api/system/readiness"], refetchInterval: 3000 } });
  const jobs = useListStudioJobs({ query: { queryKey: ["/api/studio-jobs"], refetchInterval: 1500 } });
  const create = useCreateImageJob();
  const cancel = useCancelStudioJob();
  const retry = useRetryStudioJob();
  const [prompt, setPrompt] = useState("A cinematic editorial portrait of a confident South Asian technology presenter, natural skin texture, soft window light, 85mm lens, premium production still");
  const [negativePrompt, setNegativePrompt] = useState("illustration, cartoon, plastic skin, distorted hands, text, watermark");
  const [size, setSize] = useState("1024x1024");
  const [steps, setSteps] = useState("4");
  const [guidance, setGuidance] = useState("3.5");
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 2_147_483_647)));
  const imageJobs = useMemo(
    () => (jobs.data ?? []).filter((job) => job.kind === "image") as StudioJob[],
    [jobs.data],
  );
  const [width, height] = size.split("x").map(Number);
  const refresh = () => { void queryClient.invalidateQueries(); };
  const submit = () => create.mutate({
    data: {
      prompt,
      negativePrompt,
      width,
      height,
      steps: Number(steps),
      guidance: Number(guidance),
      seed: Number(seed),
    },
  }, { onSuccess: refresh });

  return (
    <>
      <PageHeader
        eyebrow="Image lab"
        title="Create production imagery"
        description="Generate high-resolution FLUX images locally with Metal and MLX. Prompts and outputs remain on your Mac."
        action={<div className="flex items-center gap-2 rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent"><Sparkles size={14} /> {readiness.data?.imageModel ?? "FLUX · MLX"}</div>}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="font-serif text-xl font-bold">Direct the frame</h2><p className="mt-1 text-xs text-muted-foreground">Describe subject, setting, light, lens, and finish.</p></div>
            <StatusPill status={readiness.data?.imageReady ? "ready" : "attention"} />
          </div>
          {!readiness.data?.imageReady && (
            <div className="mt-5 rounded-md border border-amber-300/25 bg-amber-300/[.06] p-3 text-xs leading-relaxed text-amber-100">
              {readiness.data?.imageBlockReason ?? "Pair the Mac worker and install the local image pipeline before generating."}
            </div>
          )}
          <label className="mt-6 block text-xs font-semibold">Prompt
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} maxLength={4000} className="mt-2 w-full resize-y rounded-md border border-input bg-background p-3 text-sm leading-6 outline-none focus:border-primary/60" data-testid="textarea-image-prompt" />
          </label>
          <label className="mt-4 block text-xs font-semibold">Negative prompt
            <textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} rows={3} maxLength={2000} className="mt-2 w-full resize-y rounded-md border border-input bg-background p-3 text-sm leading-6 outline-none focus:border-primary/60" data-testid="textarea-image-negative-prompt" />
          </label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-semibold">Canvas
              <select value={size} onChange={(event) => setSize(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-image-size">
                <option value="1024x1024">Square · 1024</option>
                <option value="1344x768">Landscape · 16:9</option>
                <option value="768x1344">Portrait · 9:16</option>
              </select>
            </label>
            <label className="text-xs font-semibold">Steps<input type="number" min="1" max="50" value={steps} onChange={(event) => setSteps(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="input-image-steps" /></label>
            <label className="text-xs font-semibold">Guidance<input type="number" min="0" max="20" step=".1" value={guidance} onChange={(event) => setGuidance(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="input-image-guidance" /></label>
            <label className="text-xs font-semibold">Seed<input type="number" min="0" max="2147483647" value={seed} onChange={(event) => setSeed(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="input-image-seed" /></label>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={!readiness.data?.imageReady || prompt.trim().length < 3 || create.isPending} data-testid="button-generate-image"><ImageIcon size={15} /> {create.isPending ? "Queueing image…" : "Generate on this Mac"}</Button>
            <Button variant="ghost" onClick={() => setSeed(String(Math.floor(Math.random() * 2_147_483_647)))} data-testid="button-randomize-seed"><RefreshCw size={14} /> New seed</Button>
          </div>
          {create.isError && <p className="mt-4 text-xs text-red-200">{localError(create.error)}</p>}
        </div>

        <div>
          <SectionLabel right={<span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">{imageJobs.length} generations</span>}>Recent output</SectionLabel>
          {jobs.isLoading ? <LoadingState rows={3} /> : jobs.isError ? <ErrorState retry={jobs.refetch} /> : imageJobs.length ? (
            <div className="space-y-4">
              {imageJobs.map((job) => (
                <article key={job.id} className="overflow-hidden rounded-lg border border-border bg-card" data-testid={`card-image-job-${job.id}`}>
                  {job.outputPath ? <img src={job.outputPath} alt={`Generated image ${job.id}`} className="aspect-square w-full bg-background object-cover" /> : <div className="grid aspect-[16/9] place-items-center bg-background"><ImageIcon size={30} className="text-muted-foreground/40" /></div>}
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-3"><span className="font-mono text-[10px] text-muted-foreground">IMAGE {String(job.id).padStart(4, "0")}</span><StatusPill status={job.status} /></div>
                    {(job.status === "queued" || job.status === "rendering") && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} /></div>}
                    {job.error && <p className="mt-3 text-xs text-red-200">{job.error}</p>}
                    <div className="mt-4 flex gap-2">
                      {job.outputPath && <a href={job.outputPath} download className="inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent"><Download size={14} /> Download PNG</a>}
                      {(job.status === "queued" || job.status === "rendering") && <Button variant="ghost" onClick={() => cancel.mutate({ jobId: job.id }, { onSuccess: refresh })}><X size={14} /> Cancel</Button>}
                      {(job.status === "failed" || job.status === "cancelled") && <Button variant="secondary" onClick={() => retry.mutate({ jobId: job.id }, { onSuccess: refresh })}><RefreshCw size={14} /> Retry</Button>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : <EmptyState title="No images generated" detail="Your local FLUX generations will appear here with their exact seed and settings." />}
        </div>
      </div>
    </>
  );
}

type CallTurn = { role: "user" | "assistant"; content: string };
type CallState = "idle" | "listening" | "thinking" | "speaking";

export function LiveCallPage() {
  const queryClient = useQueryClient();
  const jobs = useListStudioJobs({ query: { queryKey: ["/api/studio-jobs"], refetchInterval: 700 } });
  const assets = useListStudioAssets();
  const respond = useCreateLiveCallTurn();
  const synthesize = useCreateVoiceJob();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playedJobRef = useRef<number | null>(null);
  const [state, setState] = useState<CallState>("idle");
  const [language, setLanguage] = useState<"en" | "bn" | "mixed">("en");
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [voiceJobId, setVoiceJobId] = useState<number | null>(null);
  const [presenterId, setPresenterId] = useState("");
  const presenter = (assets.data ?? []).find((asset) => String(asset.id) === presenterId);
  const voiceJob = (jobs.data ?? []).find((job) => job.id === voiceJobId) as StudioJob | undefined;
  const recognitionAvailable = typeof window !== "undefined" && Boolean(
    (window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition
    ?? (window as typeof window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition,
  );

  useEffect(() => {
    if (!voiceJob || voiceJob.status !== "complete" || !voiceJob.outputPath || playedJobRef.current === voiceJob.id) return;
    playedJobRef.current = voiceJob.id;
    const audio = new Audio(voiceJob.outputPath);
    audioRef.current = audio;
    setState("speaking");
    audio.onended = () => setState("idle");
    audio.onerror = () => setState("idle");
    void audio.play().catch(() => setState("idle"));
  }, [voiceJob]);

  const sendTurn = (transcript: string) => {
    const text = transcript.trim();
    if (!text || respond.isPending || synthesize.isPending) return;
    const history = turns.slice(-20);
    setTurns((current) => [...current, { role: "user", content: text }]);
    setDraft("");
    setState("thinking");
    respond.mutate({ data: { transcript: text, language, history } }, {
      onSuccess: (result) => {
        setTurns((current) => [...current, { role: "assistant", content: result.text }]);
        synthesize.mutate({
          data: { text: result.text, voiceProfileId: null, pronunciation: null, rate: 1, pitch: 0, pauseMs: 80 },
        }, {
          onSuccess: (job) => {
            playedJobRef.current = null;
            setVoiceJobId(job.id);
            void queryClient.invalidateQueries();
          },
          onError: () => setState("idle"),
        });
      },
      onError: () => setState("idle"),
    });
  };

  const startListening = () => {
    if (!recognitionAvailable || state !== "idle") return;
    const scope = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = language === "bn" ? "bn-BD" : "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => sendTurn(event.results[0]?.[0]?.transcript ?? "");
    recognition.onerror = () => setState("idle");
    recognition.onend = () => setState((current) => current === "listening" ? "idle" : current);
    recognitionRef.current = recognition;
    setState("listening");
    recognition.start();
  };

  const endCall = () => {
    recognitionRef.current?.stop();
    audioRef.current?.pause();
    recognitionRef.current = null;
    audioRef.current = null;
    setVoiceJobId(null);
    setState("idle");
  };

  return (
    <>
      <PageHeader
        eyebrow="Live room"
        title="Private AI voice call"
        description="Speak naturally with a local conversational model, then hear each response through the studio voice chain."
        action={<Button variant="danger" onClick={endCall} disabled={state === "idle" && turns.length === 0}><PhoneOff size={15} /> End room</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex min-h-[380px] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-5 md:p-7">
              {turns.length ? turns.map((turn, index) => (
                <div key={`${turn.role}-${index}`} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] rounded-lg px-4 py-3 text-sm leading-6 ${turn.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-background"}`}>
                    {turn.content}
                  </div>
                </div>
              )) : <EmptyState title="The room is ready" detail="Use the microphone or type a message. Conversation stays between this app, Ollama, and your local voice worker." />}
              {state === "thinking" && <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> Local model is thinking…</div>}
            </div>
            <div className="border-t border-border bg-background/60 p-4">
              {(respond.isError || synthesize.isError) && <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-red-200">{localError(respond.error ?? synthesize.error)}</p>}
              <div className="flex items-end gap-2">
                <button onClick={state === "listening" ? () => recognitionRef.current?.stop() : startListening} disabled={!recognitionAvailable || (state !== "idle" && state !== "listening")} className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border transition-colors disabled:opacity-40 ${state === "listening" ? "border-red-300/40 bg-red-400/10 text-red-200" : "border-border bg-secondary text-foreground hover:bg-muted"}`} aria-label={state === "listening" ? "Stop listening" : "Start listening"} data-testid="button-live-microphone">
                  {state === "listening" ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendTurn(draft); } }} rows={1} placeholder={recognitionAvailable ? "Speak or type a message…" : "Speech recognition is unavailable; type a message…"} className="min-h-11 flex-1 resize-none rounded-md border border-input bg-background px-3 py-3 text-sm outline-none focus:border-primary/60" data-testid="textarea-live-message" />
                <Button onClick={() => sendTurn(draft)} disabled={!draft.trim() || state !== "idle"} className="h-11 px-4" data-testid="button-send-live-message"><Send size={15} /></Button>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className={`grid h-12 w-12 place-items-center rounded-full border ${state === "idle" ? "border-border bg-muted text-muted-foreground" : "border-accent/40 bg-accent/10 text-accent"}`}>
                {state === "speaking" ? <Volume2 size={20} /> : state === "listening" ? <Mic size={20} /> : <UserRound size={20} />}
              </div>
              <div><p className="text-sm font-semibold capitalize">{state}</p><p className="mt-1 text-xs text-muted-foreground">{state === "idle" ? "Audio is not being captured" : "Local processing active"}</p></div>
            </div>
            <div className="mt-5 h-10 items-end gap-1" style={{ display: "flex" }} aria-hidden="true">
              {Array.from({ length: 34 }).map((_, index) => <span key={index} className={`w-1 rounded-full ${state === "idle" ? "bg-muted" : "bg-accent/70"}`} style={{ height: state === "idle" ? "5px" : `${8 + ((index * 13) % 29)}px` }} />)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <SectionLabel>Room controls</SectionLabel>
            <label className="block text-xs font-semibold">Conversation language
              <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="en">English</option><option value="bn">Bangla</option><option value="mixed">Bangla + English</option>
              </select>
            </label>
            <label className="mt-4 block text-xs font-semibold">Presenter identity
              <select value={presenterId} onChange={(event) => setPresenterId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Voice only · lowest latency</option>
                {(assets.data ?? []).filter((asset) => asset.kind === "presenter-reference").map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
              </select>
            </label>
            {presenter && <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-background p-3"><UserRound size={16} className="text-primary" /><div><p className="text-xs font-semibold">{presenter.name}</p><p className="mt-1 text-[11px] text-muted-foreground">Identity selected for generated presenter scenes</p></div></div>}
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">Live calls prioritize response time. Photoreal presenter video uses the separate Avatar workspace because diffusion video is not yet real-time on M1 hardware.</p>
          </div>
        </aside>
      </div>
    </>
  );
}
