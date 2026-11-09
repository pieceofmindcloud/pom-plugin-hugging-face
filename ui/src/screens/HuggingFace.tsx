/**
 * Search Models: the plugin's one screen, with three tabs - search Hugging
 * Face and download a GGUF, follow the downloads of this machine and of the
 * others, and set the access token. The node does the work behind each tab
 * (`../api.ts`); this screen only draws it with the POM's design kit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as hf from "../api";
import { Modal, canWrite, format, kit, notify, usePluginI18n, useServingMachines } from "../host/runtime";
import { useScreenReady } from "../host/ready";

type Tab = "search" | "downloads" | "settings";
type T = (key: string, values?: Record<string, unknown>) => string;

const PAGE_SIZE = 20;
const TABS: Tab[] = ["search", "downloads", "settings"];

const STATUS_TONE: Record<hf.DownloadStatus, string> = {
  queued: "amber",
  starting: "amber",
  downloading: "iris",
  verifying: "sky",
  completed: "aqua",
  cancelled: "amber",
  failed: "rose",
};

function initialTab(): Tab {
  const asked = new URLSearchParams(window.location.search).get("tab");
  return TABS.includes(asked as Tab) ? (asked as Tab) : "search";
}

/** Keeps the open tab in the address, so a reload or a shared link lands on it. */
function rememberTab(tab: Tab) {
  const url = new URL(window.location.href);
  if (tab === "search") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState(window.history.state, "", url);
}

/** A read that settles once and, with `every`, polls again while mounted. */
function useLoad<V>(load: (signal: AbortSignal) => Promise<V>, deps: unknown[], every?: (value: V | undefined) => number | null) {
  const [state, setState] = useState<{ data?: V; error?: unknown; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let last: V | undefined;
    const run = () => {
      load(controller.signal).then(
        (data) => {
          last = data;
          setState({ data, loading: false });
          schedule();
        },
        (error) => {
          if (controller.signal.aborted) return;
          setState((current) => ({ data: current.data, error, loading: false }));
          schedule();
        },
      );
    };
    const schedule = () => {
      const delay = every?.(last);
      if (delay != null && !controller.signal.aborted) timer = window.setTimeout(run, delay);
    };
    setState((current) => ({ data: current.data, loading: current.data === undefined }));
    run();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload };
}

export function HuggingFace() {
  const { t } = usePluginI18n();
  const { FullBleedHeader, Tabs } = kit();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [settled, setSettled] = useState(false);
  useScreenReady(settled);

  const choose = (next: Tab) => {
    setTab(next);
    rememberTab(next);
  };

  return (
    <div className="pb-page">
      <FullBleedHeader title={t("screen.title")} subtitle={t("screen.subtitle")} />
      <Tabs
        items={TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
        value={tab}
        onChange={(value: Tab) => choose(value)}
        label={t("screen.title")}
      />
      <div className="pb-content">
        {!canWrite() && <p className="pb-note pb-note-amber">{t("screen.hostTooOld")}</p>}
        {tab === "search" && <SearchTab t={t} onSettled={() => setSettled(true)} onSettings={() => choose("settings")} />}
        {tab === "downloads" && <DownloadsTab t={t} onSettled={() => setSettled(true)} />}
        {tab === "settings" && <SettingsTab t={t} onSettled={() => setSettled(true)} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- search tab

function sorted(models: hf.ModelSummary[], sort: hf.Sort) {
  return [...models].sort((a, b) => {
    if (sort === "downloads") return (b.downloads ?? -1) - (a.downloads ?? -1);
    if (sort === "recent") return (Date.parse(b.last_modified ?? "") || 0) - (Date.parse(a.last_modified ?? "") || 0);
    return 0;
  });
}

function SearchTab({ t, onSettled, onSettings }: { t: T; onSettled: () => void; onSettings: () => void }) {
  const { FullBleedToolbar, Field, Input, Select, Button, Empty, ErrorState, Skeleton, ScrollX } = kit();
  const fmt = format();
  // `?q=` opens on a search: POM's first-run guide sends the operator here with one.
  const asked = new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
  const [input, setInput] = useState(asked);
  const [query, setQuery] = useState(asked);
  const [ggufOnly, setGgufOnly] = useState(true);
  const [sort, setSort] = useState<hf.Sort>("relevance");
  const [page, setPage] = useState(1);
  const [detailsRepo, setDetailsRepo] = useState<string | null>(null);
  const [download, setDownload] = useState<{ file: hf.GgufFile; details: hf.ModelDetails } | null>(null);

  const status = useLoad((signal) => hf.providerStatus(signal), []);
  const trending = useLoad((signal) => hf.trending(signal), []);
  const results = useLoad(
    (signal) => (query ? hf.search(query, ggufOnly, page, PAGE_SIZE, sort, signal) : Promise.resolve(null)),
    [query, ggufOnly, page, sort],
  );

  useEffect(() => {
    if (!trending.loading || trending.error) onSettled();
  }, [trending.loading, trending.error, onSettled]);

  // Search while typing, after a short pause.
  useEffect(() => {
    if (input.trim() === query) return;
    const timer = window.setTimeout(() => {
      setQuery(input.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [input, query]);

  const hasQuery = query.length > 0;
  const models = useMemo(
    () => sorted(hasQuery ? (results.data?.models ?? []) : (trending.data ?? []), sort),
    [hasQuery, results.data, trending.data, sort],
  );
  const authenticated = status.data?.cli.authenticated;
  const listing = hasQuery ? results : trending;

  return (
    <>
      <FullBleedToolbar>
        <Field label={t("search.label")} className="pb-grow">
          <div className="pb-search">
            <div className="pb-search-field">
            <Input
              value={input}
              onChange={(event: { target: { value: string } }) => setInput(event.target.value)}
              onKeyDown={(event: { key: string; preventDefault: () => void }) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setQuery(input.trim());
                  setPage(1);
                }
              }}
              placeholder={t("search.placeholder")}
              aria-label={t("search.aria")}
              data-guide="model-search"
            />
            </div>
            <Button size="sm" onClick={() => { setQuery(input.trim()); setPage(1); }}>
              {t("search.button")}
            </Button>
          </div>
        </Field>
        <label className="pb-check">
          <input type="checkbox" checked={ggufOnly} onChange={(event) => { setGgufOnly(event.target.checked); setPage(1); }} />
          <span>{t("search.ggufOnly")}</span>
        </label>
        <Field label={t("search.sort")}>
          <Select value={sort} onChange={(event: { target: { value: string } }) => setSort(event.target.value as hf.Sort)}>
            <option value="relevance">{t("search.relevance")}</option>
            <option value="downloads">{t("search.mostDownloaded")}</option>
            <option value="recent">{t("search.recent")}</option>
          </Select>
        </Field>
      </FullBleedToolbar>

      {status.data && authenticated === false && (
        <p className="pb-note pb-note-amber">
          {t("search.loginRequired")}{" "}
          <button type="button" className="pb-link" onClick={onSettings}>{t("search.openSettings")}</button>
        </p>
      )}

      {listing.loading && (
        <div className="pb-stack">{[0, 1, 2, 3, 4].map((index) => <Skeleton key={index} className="pb-skeleton-row" />)}</div>
      )}
      {listing.error != null && !listing.loading && (
        <ErrorState error={listing.error} onRetry={listing.reload} />
      )}
      {!listing.loading && listing.error == null && models.length === 0 && (
        <Empty title={hasQuery ? t("search.noResults") : t("search.trending")}>
          {hasQuery ? t("search.noResultsDetail") : t("search.trendingSubtitle")}
        </Empty>
      )}
      {models.length > 0 && (
        <>
          <div className="pb-caption">
            <span>{hasQuery ? t("search.results", { count: results.data?.total ?? models.length }) : t("search.trending")}</span>
            {!hasQuery && <span>{t("search.trendingSubtitle")}</span>}
          </div>
          <ScrollX>
            <table className="pb-table">
              <thead>
                <tr>
                  <th>{t("search.columnName")}</th>
                  <th>{t("search.columnState")}</th>
                  <th>{t("search.downloads")}</th>
                  <th>{t("search.likes")}</th>
                  <th>{t("search.updated")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <ResultRow key={model.repo_id} model={model} t={t} onOpen={() => setDetailsRepo(model.repo_id)} />
                ))}
              </tbody>
            </table>
          </ScrollX>
          {hasQuery && (page > 1 || results.data?.has_next) && (
            <div className="pb-pager">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("search.previous")}</Button>
              <span className="pb-mono pb-faint">{fmt.num(page)}</span>
              <Button size="sm" variant="ghost" disabled={!results.data?.has_next} onClick={() => setPage(page + 1)}>{t("search.next")}</Button>
            </div>
          )}
        </>
      )}

      <DetailsDialog t={t} repoId={detailsRepo} onClose={() => setDetailsRepo(null)} onChoose={(file, details) => setDownload({ file, details })} />
      <DownloadDialog
        t={t}
        choice={download}
        onClose={() => setDownload(null)}
        onStarted={() => {
          // The download dialog opens over the details; close both, the
          // progress shows on the Downloads tab.
          setDetailsRepo(null);
          results.reload();
        }}
      />
    </>
  );
}

function ResultRow({ model, t, onOpen }: { model: hf.ModelSummary; t: T; onOpen: () => void }) {
  const { Badge, Button } = kit();
  const fmt = format();
  return (
    <tr>
      <td className="pb-name-cell">
        <button type="button" className="pb-link pb-strong" data-guide-repo={model.repo_id.toLowerCase()} onClick={onOpen}>
          {model.repo_id}
        </button>
        {model.author && <span className="pb-muted pb-small">{model.author}</span>}
        <p className="pb-muted pb-small pb-clamp">{model.description || t("search.hint")}</p>
      </td>
      <td>
        <div className="pb-badges">
          {model.has_gguf && <Badge tone="aqua" mono>GGUF</Badge>}
          {model.gated && <Badge tone="amber">{t("search.gated")}</Badge>}
          {model.private && <Badge tone="amber">{t("search.private")}</Badge>}
          {model.installed && <Badge tone="aqua">{t("search.downloaded")}</Badge>}
          {model.downloading && <Badge tone="amber">{t("search.downloading")}</Badge>}
          {model.tags.slice(0, 3).map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
        </div>
      </td>
      <td className="pb-mono">{fmt.num(model.downloads)}</td>
      <td className="pb-mono">{fmt.num(model.likes)}</td>
      <td title={model.last_modified ?? undefined}>{fmt.since(model.last_modified)}</td>
      <td>
        <Button size="sm" variant="ghost" onClick={onOpen} aria-label={t("search.openDetails", { name: model.repo_id })}>
          {t("search.details")}
        </Button>
      </td>
    </tr>
  );
}

function DetailsDialog({
  t,
  repoId,
  onClose,
  onChoose,
}: {
  t: T;
  repoId: string | null;
  onClose: () => void;
  onChoose: (file: hf.GgufFile, details: hf.ModelDetails) => void;
}) {
  const Dialog = Modal();
  const { Button, Badge, Empty, ErrorState, Skeleton, Panel } = kit();
  const fmt = format();
  const loaded = useLoad((signal) => (repoId ? hf.details(repoId, signal) : Promise.resolve(null)), [repoId]);
  if (!Dialog || !repoId) return null;
  const model = loaded.data;
  return (
    <Dialog
      open
      size="lg"
      title={model?.repo_id ?? t("details.title")}
      onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
    >
      {loaded.loading && <div className="pb-stack"><Skeleton className="pb-skeleton-row" /><Skeleton className="pb-skeleton-block" /></div>}
      {loaded.error != null && <ErrorState error={loaded.error} onRetry={loaded.reload} />}
      {model && (
        <div className="pb-stack pb-gap-lg">
          <div>
            <div className="pb-badges">
              {model.gated && <Badge tone="amber">{t("search.gated")}</Badge>}
              {model.private && <Badge tone="amber">{t("search.private")}</Badge>}
              {model.revision && <Badge mono>{model.revision}</Badge>}
              {model.last_modified && <span className="pb-faint pb-small">{fmt.since(model.last_modified)}</span>}
            </div>
            <p className="pb-muted">{model.description || t("search.hint")}</p>
          </div>
          <dl className="pb-facts">
            <div><dt>{t("details.license")}</dt><dd>{model.license.detected ? model.license.name || model.license.id || model.license.raw_value : t("details.licenseUnknown")}</dd></div>
            <div><dt>{t("search.downloads")}</dt><dd className="pb-mono">{fmt.num(model.downloads)}</dd></div>
            <div><dt>{t("search.likes")}</dt><dd className="pb-mono">{fmt.num(model.likes)}</dd></div>
          </dl>
          {model.tags.length > 0 && <div className="pb-badges">{model.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>}
          <div>
            <div className="pb-caption"><span>{t("details.ggufFiles")}</span><span className="pb-mono">{model.gguf_files.length}</span></div>
            {model.gguf_files.length === 0 ? (
              <Empty title={t("search.noResults")}>{t("search.hint")}</Empty>
            ) : (
              <div className="pb-files">
                {model.gguf_files.map((file) => {
                  const state = file.installed ? t("details.installed") : file.downloading ? t("search.downloading") : null;
                  return (
                    <Panel key={file.filename} className="pb-file">
                      <div className="pb-file-text">
                        <div className="pb-badges">
                          <span className="pb-mono pb-strong">{file.quantization || "GGUF"}</span>
                          {state && <Badge tone={file.installed ? "aqua" : "amber"}>{state}</Badge>}
                        </div>
                        <p className="pb-muted pb-small pb-path" title={file.filename}>{file.filename}</p>
                        <p className="pb-faint pb-small pb-mono">{fmt.bytes(file.size_bytes)}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={state ? "ghost" : "primary"}
                        disabled={Boolean(state) || !canWrite()}
                        data-guide={state ? undefined : "model-file"}
                        data-guide-quantization={(file.quantization ?? "").toLowerCase()}
                        onClick={() => onChoose(file, model)}
                      >
                        {state || t("details.download")}
                      </Button>
                    </Panel>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

const START_ERRORS: Record<string, string> = {
  cli_not_installed: "errors.providerMissing",
  authentication_required: "errors.authRequired",
  access_denied: "errors.accessDenied",
  repository_not_found: "errors.notFound",
  insufficient_space: "errors.insufficientSpace",
  destination_unavailable: "errors.destinationUnavailable",
  download_in_progress: "errors.downloadInProgress",
  model_installed: "errors.modelInstalled",
  node_not_found: "errors.machineUnreachable",
  node_unreachable: "errors.machineUnreachable",
};

function DownloadDialog({
  t,
  choice,
  onClose,
  onStarted,
}: {
  t: T;
  choice: { file: hf.GgufFile; details: hf.ModelDetails } | null;
  onClose: () => void;
  onStarted: () => void;
}) {
  const Dialog = Modal();
  const { Button, Badge, Field, Select, KeyValue } = kit();
  const fmt = format();
  const machines = useServingMachines();
  const [busy, setBusy] = useState(false);
  // "" is this machine; another id makes that machine download with its own
  // token into its own folder.
  const [target, setTarget] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!choice) {
      setTarget("");
      setPicked(new Set());
    }
  }, [choice]);
  if (!Dialog || !choice) return null;
  const { file, details } = choice;
  const remote = machines.find((machine) => machine.nodeId === target) ?? null;
  const { parts, sidecars } = hf.companions(file.filename, details.gguf_files);
  const together = [file, ...parts, ...sidecars.filter((sidecar) => picked.has(sidecar.filename))];
  const required = together.every((item) => item.size_bytes != null)
    ? together.reduce((sum, item) => sum + (item.size_bytes ?? 0), 0)
    : null;
  const insufficient = required != null && details.storage.available_bytes != null && required > details.storage.available_bytes;
  // The space and folders shown are this machine's; another one checks its own when it starts.
  const blocked = !remote && (insufficient || !details.storage.destination_available);

  async function start() {
    setBusy(true);
    try {
      const started = await hf.startDownload({
        repoId: details.repo_id,
        revision: details.revision,
        filename: file.filename,
        quantization: file.quantization,
        nodeId: remote?.nodeId,
        extraFiles: together.slice(1).map((item) => item.filename),
      });
      for (const miss of started.failed ?? []) {
        void notify({ title: t("download.extraFailed", { name: miss.filename }), level: "error" });
      }
      const name = file.quantization || file.filename;
      void notify({
        title: t("download.started"),
        body: remote ? t("download.startedOn", { name, machine: remote.name }) : t("download.startedDetail", { name }),
        level: "success",
      });
      onStarted();
      onClose();
    } catch (error) {
      const code = hf.errorCode(error);
      void notify({
        title: t((code && START_ERRORS[code]) || "errors.downloadFailed"),
        body: code === "authentication_required" ? t("errors.authDetail") : undefined,
        level: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={t("download.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={busy} disabled={blocked} data-guide="model-download-confirm" onClick={() => void start()}>
            {t("download.confirm")}
          </Button>
        </>
      }
    >
      <div className="pb-stack">
        <div>
          <p className="pb-strong">{details.repo_id}</p>
          <p className="pb-muted pb-small pb-mono pb-path">{file.filename}</p>
        </div>
        <div className="pb-badges">
          <Badge mono tone="iris">{file.quantization || "GGUF"}</Badge>
          {details.gated && <Badge tone="amber">{t("search.gated")}</Badge>}
          {details.license.detected ? (
            <Badge tone="neutral">{details.license.name || details.license.id}</Badge>
          ) : (
            <Badge tone="amber">{t("details.licenseUnknown")}</Badge>
          )}
        </div>
        {machines.length > 0 && (
          <Field label={t("download.on")}>
            <Select value={target} onChange={(event: { target: { value: string } }) => setTarget(event.target.value)}>
              <option value="">{t("download.thisMachine")}</option>
              {machines.map((machine) => <option key={machine.nodeId} value={machine.nodeId}>{machine.name}</option>)}
            </Select>
          </Field>
        )}
        {remote && <p className="pb-note">{t("download.remoteChecks", { machine: remote.name })}</p>}
        <dl className="pb-facts">
          {!remote && (
            <KeyValue label={t("download.destination")}>
              <ul className="pb-plain pb-mono pb-small pb-path">
                {details.storage.destination_paths.map((path) => <li key={path}>{path}</li>)}
              </ul>
            </KeyValue>
          )}
          <KeyValue label={t("download.required")}>{fmt.bytes(required)}</KeyValue>
          {!remote && <KeyValue label={t("download.available")}>{fmt.bytes(details.storage.available_bytes)}</KeyValue>}
          <KeyValue label={t("download.revision")}>{details.revision || "main"}</KeyValue>
        </dl>
        {parts.length > 0 && <p className="pb-muted pb-small">{t("download.splitParts", { count: parts.length + 1 })}</p>}
        {sidecars.length > 0 && (
          <fieldset className="pb-fieldset">
            <legend>{t("download.alsoDownload")}</legend>
            {sidecars.map((sidecar) => (
              <label key={sidecar.filename} className="pb-check">
                <input
                  type="checkbox"
                  checked={picked.has(sidecar.filename)}
                  onChange={(event) => {
                    const next = new Set(picked);
                    if (event.target.checked) next.add(sidecar.filename);
                    else next.delete(sidecar.filename);
                    setPicked(next);
                  }}
                />
                <span className="pb-mono pb-path">{sidecar.filename}</span>
                <span className="pb-faint">{fmt.bytes(sidecar.size_bytes)}</span>
              </label>
            ))}
          </fieldset>
        )}
        {details.gated && <p className="pb-note pb-note-amber">{t("download.gatedDetail")}</p>}
        {!remote && insufficient && <p className="pb-note pb-note-rose">{t("errors.insufficientSpace")}</p>}
        {!remote && !details.storage.destination_available && <p className="pb-note pb-note-rose">{t("errors.destinationUnavailable")}</p>}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------- downloads tab

const pollWhileRunning = (jobs: hf.DownloadJob[] | undefined) => ((jobs ?? []).some(hf.isActive) ? 2_000 : 10_000);

function DownloadsTab({ t, onSettled }: { t: T; onSettled: () => void }) {
  const { Empty } = kit();
  const machines = useServingMachines();
  const local = useLoad((signal) => hf.localDownloads(signal), [], pollWhileRunning);
  const [othersHave, setOthersHave] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!local.loading) onSettled();
  }, [local.loading, onSettled]);
  const anything = (local.data?.length ?? 0) > 0 || Object.values(othersHave).some(Boolean);
  return (
    <div className="pb-stack">
      <DownloadsList t={t} downloads={local} />
      {machines.map((machine) => (
        <MachineDownloads
          key={machine.nodeId}
          t={t}
          nodeId={machine.nodeId}
          name={machine.name}
          onCount={(count) => setOthersHave((current) => (current[machine.nodeId] === count > 0 ? current : { ...current, [machine.nodeId]: count > 0 }))}
        />
      ))}
      {!local.loading && !local.error && !anything && <Empty title={t("downloads.empty")}>{t("downloads.emptyDetail")}</Empty>}
    </div>
  );
}

/** Another machine's downloads, started from here; nothing shows when it has none or cannot be reached. */
function MachineDownloads({ t, nodeId, name, onCount }: { t: T; nodeId: string; name: string; onCount: (count: number) => void }) {
  const downloads = useLoad((signal) => hf.machineDownloads(nodeId, signal), [nodeId], pollWhileRunning);
  useEffect(() => onCount(downloads.data?.length ?? 0), [downloads.data, onCount]);
  if (downloads.error) return null;
  return <DownloadsList t={t} downloads={downloads} nodeId={nodeId} machine={name} />;
}

function DownloadsList({
  t,
  downloads,
  nodeId,
  machine,
}: {
  t: T;
  downloads: { data?: hf.DownloadJob[]; error?: unknown; loading: boolean; reload: () => void };
  nodeId?: string;
  machine?: string;
}) {
  const { Panel, PanelHeader, ErrorState, Skeleton } = kit();
  const previous = useRef(new Map<string, hf.DownloadStatus | undefined>());
  const list = downloads.data ?? [];

  // A download that finishes or fails while the tab is open is announced once.
  useEffect(() => {
    for (const job of list) {
      const before = previous.current.get(job.id);
      if (before && before !== job.download_status && job.download_status === "completed") {
        void notify({ title: t("status.completed"), body: machine ? `${job.filename} - ${machine}` : job.filename, level: "success" });
      }
      if (before && before !== job.download_status && job.download_status === "failed") {
        void notify({ title: t("errors.downloadFailed"), body: job.error ?? undefined, level: "error" });
      }
      previous.current.set(job.id, job.download_status);
    }
  }, [list, machine, t]);

  if (downloads.error && !machine) return <ErrorState error={downloads.error} onRetry={downloads.reload} />;
  if (downloads.loading) return <Panel><Skeleton className="pb-skeleton-block" /></Panel>;
  if (list.length === 0) return null;
  return (
    <Panel>
      <PanelHeader
        title={machine ? t("downloads.on", { machine }) : t("downloads.thisMachine")}
        subtitle={t("downloads.count", { count: list.filter(hf.isActive).length })}
      />
      <div>{list.map((job) => <DownloadRow key={job.id} t={t} job={job} nodeId={nodeId} onRefresh={downloads.reload} />)}</div>
    </Panel>
  );
}

function DownloadRow({ t, job, nodeId, onRefresh }: { t: T; job: hf.DownloadJob; nodeId?: string; onRefresh: () => void }) {
  const { Badge, Button, Progress } = kit();
  const fmt = format();
  const status = job.download_status ?? "failed";
  const progress = hf.percentOf(job);
  const name = job.quantization || job.filename || job.title || job.repo_id || job.id;
  const ended = status === "failed" || status === "cancelled";

  const act = (action: (id: string, node?: string) => Promise<unknown>, failure: string) => async () => {
    try {
      await action(job.id, nodeId);
      onRefresh();
    } catch {
      void notify({ title: t(failure), level: "error" });
    }
  };

  return (
    <div className="pb-download">
      <div className="pb-download-head">
        <div className="pb-file-text">
          <p className="pb-strong pb-path" title={job.repo_id}>{job.repo_id || job.title}</p>
          <p className="pb-muted pb-small pb-mono pb-path" title={job.filename}>{name}</p>
        </div>
        <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>
      </div>
      <Progress value={progress} tone={STATUS_TONE[status]} />
      <div className="pb-meta">
        <span>{progress == null ? "-" : `${Math.round(progress)}%`}</span>
        <span>{fmt.bytes(job.bytes_downloaded)} / {fmt.bytes(job.total_bytes)}</span>
        {job.speed_bytes_per_sec != null && <span>{t("downloads.speed")} {fmt.rate(job.speed_bytes_per_sec)}</span>}
        {job.eta_seconds != null && <span>{t("downloads.remaining", { time: fmt.duration(job.eta_seconds) })}</span>}
      </div>
      {job.local_path && <p className="pb-muted pb-small pb-path">{t("downloads.savedTo")} <span className="pb-mono">{job.local_path}</span></p>}
      {job.error && <p className="pb-error pb-small pb-path">{job.error}</p>}
      {canWrite() && (hf.isActive(job) || ended) && (
        <div className="pb-row">
          {hf.isActive(job) && <Button size="sm" variant="ghost" onClick={() => void act(hf.cancelDownload, "errors.actionFailed")()}>{t("downloads.cancel")}</Button>}
          {ended && <Button size="sm" variant="outline" onClick={() => void act(hf.retryDownload, "errors.actionFailed")()}>{t("downloads.retry")}</Button>}
          {ended && <Button size="sm" variant="ghost" onClick={() => void act(hf.dismissDownload, "errors.dismissFailed")()}>{t("downloads.dismiss")}</Button>}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- settings tab

/**
 * The node's Hugging Face token. The field starts empty on purpose: the node
 * only answers a mask, and a saved secret never fills a password input.
 */
function SettingsTab({ t, onSettled }: { t: T; onSettled: () => void }) {
  const { Panel, PanelHeader, Button, Field, Input, ErrorState, Skeleton, Mono, Footnote } = kit();
  const config = useLoad((signal) => hf.tokenConfig(signal), []);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!config.loading) onSettled();
  }, [config.loading, onSettled]);

  async function save(token: string | null) {
    setSaving(true);
    try {
      await hf.saveToken(token);
      setDraft("");
      void notify({ title: t(token ? "settings.saved" : "settings.cleared"), level: "success" });
      config.reload();
    } catch (error) {
      void notify({ title: t("settings.saveFailed"), body: error instanceof Error ? error.message : undefined, level: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        actions={
          <div className="pb-row">
            <Button variant="primary" loading={saving} disabled={!draft.trim() || !canWrite()} onClick={() => void save(draft.trim())}>
              {t("settings.save")}
            </Button>
            <Button variant="ghost" loading={saving} disabled={!config.data?.configured || !canWrite()} onClick={() => void save(null)}>
              {t("settings.clear")}
            </Button>
          </div>
        }
      />
      <div className="pb-panel-inner">
        {config.error != null ? (
          <ErrorState title={t("settings.saveFailed")} error={config.error} onRetry={config.reload} />
        ) : (
          <div className="pb-stack">
            <Field label={t("settings.tokenLabel")} hint={t("settings.tokenHint")}>
              <Input
                type="password"
                name="hugging-face-token"
                autoComplete="new-password"
                spellCheck={false}
                value={draft}
                placeholder={config.data?.masked ?? t("settings.tokenPlaceholder")}
                onChange={(event: { target: { value: string } }) => setDraft(event.target.value)}
                onKeyDown={(event: { key: string }) => {
                  if (event.key === "Enter" && draft.trim()) void save(draft.trim());
                }}
              />
            </Field>
            <div className="pb-row pb-muted pb-small">
              {config.loading ? (
                <Skeleton className="pb-skeleton-line" />
              ) : (
                <>
                  <span>{t("settings.source", { source: config.data?.masked ? config.data.source : "none" })}</span>
                  {config.data?.masked && <Mono>{config.data.masked}</Mono>}
                </>
              )}
            </div>
            <Footnote icon={null}>{t("settings.precedence")}</Footnote>
          </div>
        )}
      </div>
    </Panel>
  );
}
