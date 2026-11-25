import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { JsonValue } from "../contracts/generated.ts";
import { useT } from "../i18n/I18nProvider";
import { htmlSource, parseHtmlAction, type HtmlAction } from "./htmlActions.ts";
import "./html-node.css";

type Payload = Record<string, JsonValue>;
export function HtmlNodeView({html, state, locked = false, onAction, onEditSource}: {
  html: string;
  state: Payload;
  locked?: boolean;
  onEditSource?: () => void;
  onAction?: (action: "submit" | "compose", payload: Payload) => Promise<void>;
}) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const initialized = useRef(false);
  const latest = useRef({state, locked, onAction, t});
  latest.current = {state, locked, onAction, t};
  const pending = useRef<HtmlAction | null>(null);
  const [ready, setReady] = useState(false);
  const [review, setReview] = useState<HtmlAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const epoch = useMemo(() => crypto.randomUUID(), [html]);
  const seen = useRef(new Set<string>());
  // The desktop protocol can finish loading before passive effects run.
  // Reset synchronously at commit so document.write's second load event cannot
  // replace the live channel with an unconnected initialization attempt.
  useLayoutEffect(() => {
    initialized.current = false;
    pending.current = null;
    setReady(false); setReview(null); setStatus(""); setSaving(false); seen.current.clear();
    return () => { port.current?.close(); port.current = null; };
  }, [epoch]);
  const reply = (action: HtmlAction, ok: boolean, error?: string) =>
    port.current?.postMessage({requestId: action.requestId, ok,
      ...(ok ? {result: {status: "ok"}} : {error})});
  const initialize = () => {
    if (initialized.current || !frame.current?.contentWindow) return;
    initialized.current = true;
    const channel = new MessageChannel();
    port.current = channel.port1;
    channel.port1.onmessage = ({data}) => {
      if (data?.type === "opendirector.ready" && data.version === 1) {
        setReady(true); return;
      }
      const action = parseHtmlAction(data);
      if (!action) return;
      const current = latest.current;
      if (seen.current.has(action.requestId)) return;
      if (seen.current.size >= 1000) {
        reply(action, false, current.t("html.limit")); return;
      }
      seen.current.add(action.requestId);
      if (current.locked || !current.onAction) {
        reply(action, false, current.t("html.unavailable")); return;
      }
      if (pending.current) { reply(action, false, current.t("html.busy")); return; }
      pending.current = action;
      setReview(action); setStatus("");
    };
    channel.port1.start();
    frame.current.contentWindow.postMessage({type: "opendirector.init", html: htmlSource(html),
      state: latest.current.state}, "*", [channel.port2]);
  };
  const apply = async () => {
    if (!review || saving || latest.current.locked) return;
    const action = review, activePort = port.current;
    setSaving(true);
    try {
      await latest.current.onAction!(action.action, action.payload);
      if (port.current !== activePort) return;
      reply(action, true);
      setStatus(t(action.action === "submit" ? "html.saved" : "html.composed"));
    } catch {
      if (port.current !== activePort) return;
      reply(action, false, t("html.saveFailed")); setStatus(t("html.saveFailed"));
    } finally {
      if (port.current === activePort) {
        pending.current = null; setReview(null); setSaving(false);
      }
    }
  };
  return <div className="cw-html-node nodrag nopan nowheel" onDoubleClick={event => event.stopPropagation()}>
    {!ready && <div className="cw-html-loading" role="status">{t("html.loading")}</div>}
    <iframe style={{visibility: ready ? "visible" : "hidden"}} key={epoch} ref={frame} title={t("html.frame")} src="/html-runtime.html"
      sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
      onLoad={initialize} />
    {onEditSource && <button className="cw-html-source" onClick={onEditSource}>{t("html.source")}</button>}
    {review && <div className="cw-html-review" role="group" aria-label={t("html.review")}>
      <strong>{t("html.review")}</strong>
      <pre>{JSON.stringify(review.payload, null, 2)}</pre>
      <div><button disabled={saving || locked} onClick={() => void apply()}>
        {t(saving ? "html.saving" : review.action === "submit" ? "html.save" : "html.compose")}
      </button><button disabled={saving} onClick={() => {
        reply(review, false, t("html.cancelled")); pending.current = null; setReview(null);
      }}>{t("html.dismiss")}</button></div>
    </div>}
    {status && <div className="cw-html-status" role="status">{status}</div>}
  </div>;
}
