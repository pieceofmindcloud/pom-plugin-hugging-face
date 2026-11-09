/**
 * The only place, with `ready.ts`, that touches `globalThis.__POM_HOST__`.
 *
 * The POM exposes React, its design kit, i18n, the events protocol and the
 * plugin RPC on that object; `build.mjs` swaps the `react` imports for it, so
 * the bundle never carries a second React. Every helper degrades on an older
 * host instead of throwing at import time.
 */
import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";

declare const __POM_PLUGIN_CODE__: string;

type I18nHook = () => { t: (key: string, values?: Record<string, unknown>) => string; locale?: string };

export type Tone = "neutral" | "iris" | "aqua" | "amber" | "rose" | "sky" | "lime";

/** The part of the POM design kit (`components/ui.tsx`) the screens draw with. */
export type HostUi = {
  PageHeader: ComponentType<{ title: string; subtitle?: ReactNode; actions?: ReactNode }>;
  Panel: ComponentType<{ className?: string; children?: ReactNode }>;
  PanelHeader: ComponentType<{ title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }>;
  Button: ComponentType<{
    variant?: "primary" | "outline" | "ghost" | "danger";
    size?: "sm" | "md";
    loading?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }>;
  Badge: ComponentType<{ tone?: Tone; mono?: boolean; children: ReactNode }>;
  KeyValue: ComponentType<{ label: string; children: ReactNode }>;
  Empty: ComponentType<{ title: string; icon?: ReactNode; action?: ReactNode; children?: ReactNode }>;
  ErrorState: ComponentType<{ title?: string; error: unknown; onRetry?: () => void }>;
};

/** Protocol shared by every POM -> plugin event and plugin -> POM command. */
export const EVENTS_PROTOCOL = "pom-plugin-events/v1";
const EVENT_DOM = "pom:plugin-event";
const REQUEST_DOM = "pom:plugin-request";

export type PomEventType =
  | "locale.changed"
  | "theme.changed"
  | "preferences.changed"
  | "notification.received"
  | "notification.response"
  | "deployment.started"
  | "model.serving"
  | "model.stopped"
  | "loader.retry";

export type PomEvent<P = Record<string, unknown>> = {
  protocol: typeof EVENTS_PROTOCOL;
  id: string;
  type: PomEventType;
  target: string;
  source: "pom";
  at: string;
  payload: P;
};

export type NotifyRequest = {
  title: string;
  body?: string;
  level?: "info" | "success" | "warning" | "error";
  /** `local` (default): a toast here. `network`: every node, through the network Chat. */
  scope?: "local" | "network";
};

export type ConfirmRequest = {
  title: string;
  body?: string;
  acceptLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  /** `notification` (default): in the POM bell. `dialog`: a modal now. */
  display?: "notification" | "dialog";
};

export type NotificationResponse = {
  request_id: string;
  kind: "notify" | "confirm" | "loader";
  action: "delivered" | "failed" | "accepted" | "cancelled";
  error?: string;
};

type Handler = (event: PomEvent) => void;

type ScopedApi = {
  events: { subscribe: (type: PomEventType | "*", handler: Handler, options?: { replay?: boolean }) => () => void };
  notifications: {
    notify: (request: NotifyRequest) => Promise<NotificationResponse>;
    confirm: (request: ConfirmRequest) => Promise<NotificationResponse>;
  };
  rpc?: <T = unknown>(op: string, params?: unknown) => Promise<T>;
  loader?: HostLoader;
};

type LoaderText = { title?: string; message?: string };

/** POM's loader and installer over this plugin's screen (host version 7). */
type HostLoader = {
  show: (request?: LoaderText) => Promise<NotificationResponse>;
  progress: (request: LoaderText & { progress: number }) => Promise<NotificationResponse>;
  error: (request: LoaderText & { message: string; retry?: boolean }) => Promise<NotificationResponse>;
  success: (request?: LoaderText) => Promise<NotificationResponse>;
  hide: () => Promise<NotificationResponse>;
};

type HostApi = {
  get: <T>(path: string, options?: { signal?: AbortSignal }) => Promise<T>;
  /** Host version 8: a same-origin POST with the panel's own credentials. */
  post?: <T>(path: string, body?: unknown) => Promise<T>;
};

type HostFormat = {
  bytes: (value: number | null | undefined) => string;
  num: (value: number | null | undefined, digits?: number) => string;
  since: (iso: string | null | undefined) => string;
  duration: (seconds: number | null | undefined) => string;
  rate: (bytesPerSec: number | null | undefined) => string;
};

type ClusterPeer = { node_id: string; short_id?: string; is_self?: boolean; node?: { hostname?: string; profile?: string } };

type PomHost = {
  version?: number;
  ui: HostUi;
  format: HostFormat;
  hooks: { useI18n: I18nHook; useCluster?: () => { data?: { peers?: ClusterPeer[] } } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: { Modal?: ComponentType<any> };
  api?: HostApi;
  context?: () => { locale: string; theme: "light" | "dark" };
  plugin?: (code: string) => ScopedApi;
};

function host(): PomHost {
  const current = (globalThis as typeof globalThis & { __POM_HOST__?: PomHost }).__POM_HOST__;
  if (!current) throw new Error("POM host SDK is not installed");
  return current;
}

function maybeHost(): PomHost | undefined {
  return (globalThis as typeof globalThis & { __POM_HOST__?: PomHost }).__POM_HOST__;
}

/** The host SDK version: 2 events, 4 RPC, 5 `ui.Tabs`, 6 `ready()`, 7 the loader, 8 `api.post`. */
export function hostVersion(): number {
  return maybeHost()?.version ?? 1;
}

/** The POM's own components, so the screen looks like the rest of the panel. */
export function ui(): HostUi {
  return host().ui;
}

export function formatBytes(value: number | null | undefined): string {
  return host().format.bytes(value);
}

/** The POM's number, date and size formatting, so values read like the rest of the panel. */
export function format(): HostFormat {
  return host().format;
}

/**
 * The POM's whole design kit and its Modal. The plugin draws only with these
 * and its own scoped CSS: the panel's utility classes are not part of the
 * contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function kit(): Record<string, ComponentType<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return host().ui as unknown as Record<string, ComponentType<any>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Modal(): ComponentType<any> | null {
  return host().components?.Modal ?? null;
}

/** GET on the node's own API (same origin, the panel's session). */
export function nodeGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const api = host().api;
  if (!api) return Promise.reject(new Error("host_too_old"));
  return api.get<T>(path, { signal });
}

/** Whether this POM lets a plugin screen write through the node's API (host version 8). */
export function canWrite(): boolean {
  return typeof maybeHost()?.api?.post === "function";
}

/** POST on the node's own API; rejects with `host_too_old` before host version 8. */
export function nodePost<T>(path: string, body?: unknown): Promise<T> {
  const post = host().api?.post;
  if (!post) return Promise.reject(new Error("host_too_old"));
  return post<T>(path, body);
}

/** The other machines of the network that may hold models (live, not visitors). */
export function useServingMachines(): { nodeId: string; name: string }[] {
  const useCluster = host().hooks.useCluster;
  const cluster = useCluster ? useCluster() : { data: undefined };
  const seen = new Set<string>();
  return (cluster.data?.peers ?? [])
    .filter((peer) => !peer.is_self && peer.node?.profile !== "visitor")
    .map((peer) => ({ nodeId: peer.node_id, name: peer.node?.hostname || peer.short_id || peer.node_id.slice(0, 12) }))
    .filter((machine) => !seen.has(machine.nodeId) && Boolean(seen.add(machine.nodeId)));
}

/** Translations of this plugin; the build prefixes every key with the plugin code. */
export function usePluginI18n(): ReturnType<I18nHook> {
  const { t, locale } = host().hooks.useI18n();
  return { t: (key: string, values?: Record<string, unknown>) => t(`${__POM_PLUGIN_CODE__}.${key}`, values), locale };
}

function scoped(): ScopedApi | null {
  const current = maybeHost();
  return typeof current?.plugin === "function" ? current.plugin(__POM_PLUGIN_CODE__) : null;
}

/** Calls the plugin's `rpc.<op>` (host version 4). A refusal arrives as `{error}` in the reply. */
export function rpc<T>(op: string, params?: unknown): Promise<T> {
  const api = scoped();
  if (typeof api?.rpc !== "function") {
    return Promise.reject(new Error("this POM version has no plugin RPC"));
  }
  return api.rpc<T>(op, params);
}

/** GET through the node's proxy to the plugin's own loopback server (`ui.upstream`). */
export function getUpstream<T>(path: string): Promise<T> {
  const api = maybeHost()?.api;
  if (!api) return Promise.reject(new Error("POM host API is not installed"));
  return api.get<T>(`${upstreamPrefix()}/${path.replace(/^\/+/, "")}`);
}

/** Same-origin prefix of the plugin's upstream, for iframes, fetch POSTs and WebSockets. */
export function upstreamPrefix(): string {
  return `/api/ui/plugins/${encodeURIComponent(__POM_PLUGIN_CODE__)}/proxy`;
}

/** URL of an asset this plugin declares in `ui/manifest.json`. */
export function assetUrl(path: string): string {
  return `/api/ui/plugins/${encodeURIComponent(__POM_PLUGIN_CODE__)}/assets/${path}`;
}

function reachesThisPlugin(event: PomEvent): boolean {
  return event.protocol === EVENTS_PROTOCOL && (event.target === "*" || event.target === __POM_PLUGIN_CODE__);
}

/**
 * Subscribe to POM events. Uses the SDK when the host provides it and falls
 * back to the `pom:plugin-event` DOM channel. Returns the unsubscribe function.
 */
export function onPomEvent(type: PomEventType | "*", handler: Handler, replay = false): () => void {
  const api = scoped();
  if (api) return api.events.subscribe(type, handler, { replay });
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PomEvent>).detail;
    if (!detail || !reachesThisPlugin(detail)) return;
    if (type === "*" || detail.type === type) handler(detail);
  };
  window.addEventListener(EVENT_DOM, listener);
  return () => window.removeEventListener(EVENT_DOM, listener);
}

/** React helper: calls `handler` for each matching event while mounted. */
export function usePomEvent(type: PomEventType | "*", handler: Handler, replay = false): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => onPomEvent(type, (event) => latest.current(event), replay), [type, replay]);
}

/** Current locale and theme, kept up to date by `locale.changed` and `theme.changed`. */
export function usePomContext(): { locale: string; theme: "light" | "dark" } {
  const initial = maybeHost()?.context?.() ?? {
    locale: document.documentElement.lang || "en",
    theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
  };
  const [context, setContext] = useState(initial);
  usePomEvent("locale.changed", (event) => {
    const locale = event.payload.locale;
    if (typeof locale === "string") setContext((current) => ({ ...current, locale }));
  });
  usePomEvent("theme.changed", (event) => {
    const theme = event.payload.theme;
    if (theme === "light" || theme === "dark") setContext((current) => ({ ...current, theme }));
  });
  return context;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Command sent through the DOM channel; the answer is a `notification.response` event. */
function commandThroughDom(type: "notification.notify" | "notification.confirm", payload: NotifyRequest | ConfirmRequest) {
  const id = randomId();
  return new Promise<NotificationResponse>((resolve) => {
    const stop = onPomEvent("notification.response", (event) => {
      const response = event.payload as unknown as NotificationResponse;
      if (response.request_id !== id) return;
      stop();
      resolve(response);
    });
    window.dispatchEvent(new CustomEvent(REQUEST_DOM, {
      detail: { protocol: EVENTS_PROTOCOL, id, type, plugin_code: __POM_PLUGIN_CODE__, payload },
    }));
  });
}

/** Shows a notice here (`scope: "local"`) or to every node of the network. */
export function notify(request: NotifyRequest): Promise<NotificationResponse> {
  const api = scoped();
  return api ? api.notifications.notify(request) : commandThroughDom("notification.notify", request);
}

/** Asks this user to accept or cancel; resolves with the answer. */
export function confirm(request: ConfirmRequest): Promise<NotificationResponse> {
  const api = scoped();
  return api ? api.notifications.confirm(request) : commandThroughDom("notification.confirm", request);
}

const noLoader = (): Promise<NotificationResponse> =>
  Promise.resolve({ request_id: "", kind: "loader", action: "failed", error: "host_unavailable" });

/**
 * POM draws the loader and the installer; the plugin only says what is going
 * on. While the plugin holds one of these states its screen stays covered,
 * `ready()` included; `hide()` or the end of `success()` opens it. On a host
 * older than version 7 every call resolves `failed`.
 */
export const loader: HostLoader = {
  show: (request = {}) => scoped()?.loader?.show(request) ?? noLoader(),
  progress: (request) => scoped()?.loader?.progress(request) ?? noLoader(),
  error: (request) => scoped()?.loader?.error(request) ?? noLoader(),
  success: (request = {}) => scoped()?.loader?.success(request) ?? noLoader(),
  hide: () => scoped()?.loader?.hide() ?? noLoader(),
};

/** "Try again" on the loader's error. Returns the unsubscribe function. */
export function onLoaderRetry(handler: () => void): () => void {
  return onPomEvent("loader.retry", () => handler());
}
