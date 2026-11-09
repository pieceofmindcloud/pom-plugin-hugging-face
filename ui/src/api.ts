/**
 * The node's model provider API (`/api/ui/model-provider/*` and `/api/ui/jobs`),
 * read and written with the panel's own session through the host SDK. The
 * downloads themselves, the token storage and the remote machines all stay in
 * the POM node: this plugin only draws them.
 */
import { nodeGet, nodePost } from "./host/runtime";

export type DownloadStatus = "queued" | "starting" | "downloading" | "verifying" | "completed" | "cancelled" | "failed";

export interface ModelSummary {
  repo_id: string;
  author: string | null;
  description: string | null;
  downloads: number | null;
  likes: number | null;
  private: boolean | null;
  gated: boolean | null;
  tags: string[];
  last_modified: string | null;
  has_gguf: boolean | null;
  installed: boolean;
  downloading: boolean;
}

export interface SearchResponse {
  models: ModelSummary[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
}

export interface GgufFile {
  filename: string;
  size_bytes: number | null;
  quantization: string | null;
  installed: boolean;
  downloading: boolean;
}

export interface ModelDetails {
  repo_id: string;
  description: string | null;
  last_modified: string | null;
  revision: string | null;
  downloads: number | null;
  likes: number | null;
  private: boolean | null;
  gated: boolean | null;
  tags: string[];
  license: { id: string | null; name: string | null; raw_value: string | null; detected: boolean };
  files: { filename: string }[];
  gguf_files: GgufFile[];
  storage: { available_bytes: number | null; destination_available: boolean; destination_paths: string[] };
}

export interface ProviderStatus {
  cli: { installed: boolean; authenticated: boolean; username: string | null };
}

export interface TokenConfig {
  configured: boolean;
  masked: string | null;
  source: string;
}

export interface DownloadJob {
  id: string;
  kind?: string;
  state?: string;
  title?: string;
  repo_id?: string;
  filename?: string;
  quantization?: string | null;
  download_status?: DownloadStatus;
  progress?: number | null;
  bytes_downloaded?: number | null;
  total_bytes?: number | null;
  speed_bytes_per_sec?: number | null;
  eta_seconds?: number | null;
  local_path?: string | null;
  error?: string | null;
}

export type Sort = "relevance" | "downloads" | "recent";

/** Public Hugging Face discovery, without the node and without signing in. */
export const TRENDING_URL = "https://huggingface.co/api/models?sort=trendingScore&limit=20&filter=gguf";

export function searchPath(query: string, ggufOnly: boolean, page: number, pageSize: number, sort: Sort): string {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  if (ggufOnly) params.set("gguf_only", "true");
  if (sort !== "relevance") params.set("sort", sort);
  return `/api/ui/model-provider/search?${params.toString()}`;
}

export const search = (query: string, ggufOnly: boolean, page: number, pageSize: number, sort: Sort, signal?: AbortSignal) =>
  nodeGet<SearchResponse>(searchPath(query, ggufOnly, page, pageSize, sort), signal);

export function details(repoId: string, signal?: AbortSignal) {
  return nodeGet<ModelDetails>(`/api/ui/model-provider/details?${new URLSearchParams({ repo_id: repoId })}`, signal);
}

export const providerStatus = (signal?: AbortSignal) => nodeGet<ProviderStatus>("/api/ui/model-provider/status", signal);
export const tokenConfig = (signal?: AbortSignal) => nodeGet<TokenConfig>("/api/ui/model-provider/config", signal);
export const saveToken = (token: string | null) => nodePost<TokenConfig>("/api/ui/model-provider/config", { token });

/** `?node_id=` for a route that acts on another machine, or nothing for this one. */
export function nodeQuery(nodeId?: string): string {
  return nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : "";
}

/** This machine's model downloads: the `model_download` jobs of `/api/ui/jobs`. */
export async function localDownloads(signal?: AbortSignal): Promise<DownloadJob[]> {
  const answer = await nodeGet<{ jobs?: DownloadJob[] }>("/api/ui/jobs", signal);
  return (answer.jobs ?? []).filter((job) => job.kind === "model_download");
}

/** Another machine's model downloads, asked through this node. */
export async function machineDownloads(nodeId: string, signal?: AbortSignal): Promise<DownloadJob[]> {
  const answer = await nodeGet<{ downloads?: DownloadJob[] }>(`/api/ui/model-provider/downloads${nodeQuery(nodeId)}`, signal);
  return answer.downloads ?? [];
}

export interface StartDownload {
  repoId: string;
  revision?: string | null;
  filename: string;
  quantization?: string | null;
  nodeId?: string;
  extraFiles?: string[];
}

export function startDownload(request: StartDownload) {
  return nodePost<{ download_id: string; failed?: { filename: string; code: string }[] }>("/api/ui/model-provider/downloads", {
    repo_id: request.repoId,
    revision: request.revision ?? null,
    filename: request.filename,
    quantization: request.quantization ?? null,
    ...(request.nodeId ? { node_id: request.nodeId } : {}),
    ...(request.extraFiles?.length ? { extra_files: request.extraFiles } : {}),
  });
}

const downloadAction = (action: "cancel" | "dismiss" | "retry") => (downloadId: string, nodeId?: string) =>
  nodePost<unknown>(`/api/ui/model-provider/downloads/${encodeURIComponent(downloadId)}/${action}${nodeQuery(nodeId)}`);

export const cancelDownload = downloadAction("cancel");
export const dismissDownload = downloadAction("dismiss");
export const retryDownload = downloadAction("retry");

export function percentOf(job: DownloadJob): number | null {
  if (job.bytes_downloaded == null || job.total_bytes == null || job.total_bytes <= 0) return job.progress ?? null;
  return Math.min(100, Math.max(0, (job.bytes_downloaded / job.total_bytes) * 100));
}

export const isActive = (job: DownloadJob) => job.state === "running";

const SPLIT_PART = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;

/**
 * The other files a download of `filename` goes with: `parts` are the rest of
 * a split GGUF (the model does not load without them), `sidecars` the vision
 * projectors and MTP drafts the operator may add.
 */
export function companions(filename: string, files: GgufFile[]) {
  const split = SPLIT_PART.exec(filename);
  const parts = split
    ? files.filter((file) => {
        const other = SPLIT_PART.exec(file.filename);
        return file.filename !== filename && other !== null && other[1] === split[1] && other[3] === split[3];
      })
    : [];
  const sidecars = files.filter(
    (file) => file.filename !== filename && !parts.includes(file) && /mmproj|(^|[-_.])mtp([-_.]|$)/i.test(file.filename),
  );
  return { parts, sidecars };
}

/** The node's refusal code (`{"error": {"code": ..}}`) out of a failed call, when there is one. */
export function errorCode(error: unknown): string | null {
  const body = (error as { body?: { error?: { code?: unknown } } } | null)?.body;
  return typeof body?.error?.code === "string" ? body.error.code : null;
}

type TrendingModel = {
  id?: unknown;
  author?: unknown;
  downloads?: unknown;
  likes?: unknown;
  private?: unknown;
  gated?: unknown;
  tags?: unknown;
  lastModified?: unknown;
};

export async function trending(signal?: AbortSignal): Promise<ModelSummary[]> {
  const response = await fetch(TRENDING_URL, { signal, credentials: "omit", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Hugging Face returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Hugging Face returned an invalid model list");
  return payload.flatMap((value: TrendingModel) => {
    if (typeof value?.id !== "string" || value.id.length === 0) return [];
    return [
      {
        repo_id: value.id,
        author: typeof value.author === "string" ? value.author : (value.id.split("/")[0] ?? null),
        description: null,
        downloads: typeof value.downloads === "number" ? value.downloads : null,
        likes: typeof value.likes === "number" ? value.likes : null,
        private: typeof value.private === "boolean" ? value.private : null,
        gated: typeof value.gated === "boolean" ? value.gated : null,
        tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [],
        last_modified: typeof value.lastModified === "string" ? value.lastModified : null,
        has_gguf: true,
        installed: false,
        downloading: false,
      },
    ];
  });
}
