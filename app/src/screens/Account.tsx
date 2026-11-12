// Screen 9 of the design: Account. There are no accounts yet, so this screen holds what is real today: the
// wardrobe data on this device.
import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ConfirmButton } from "../components/ConfirmButton.tsx";
import { ChevronIcon, PersonIcon } from "../components/Icons.tsx";
import { ErrorPanel } from "../components/Messages.tsx";
import { TabScreen } from "../components/Screen.tsx";
import { API_BASE_URL } from "../config.ts";
import { countOf } from "../lib/format.ts";
import { link } from "../lib/router.ts";
import type { OwnedShirt } from "../lib/types.ts";
import { parseWardrobe } from "../lib/wardrobe.ts";
import { useStore } from "../store.tsx";

const shirts = (n: number) => countOf(n, "shirt", "shirts");

export function Account() {
  const { wardrobe, replaceWardrobe, resetAll } = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // A file that was read and is valid, waiting for the person to agree to replace their wardrobe.
  const [waiting, setWaiting] = useState<OwnedShirt[] | null>(null);

  // The file is the wardrobe as it is: the same format as engine/data/wardrobes/*.json.
  function exportWardrobe() {
    const blob = new Blob([`${JSON.stringify(wardrobe, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pearfit-wardrobe.json";
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function applyImport(imported: OwnedShirt[]) {
    replaceWardrobe(imported);
    setWaiting(null);
    setDone(`Imported ${shirts(imported.length)}.`);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so that picking the same file again still fires this
    if (!file) return;
    setDone(null);
    setFailure(null);
    setWaiting(null);
    try {
      const imported = parseWardrobe(JSON.parse(await file.text()));
      if (wardrobe.length === 0) applyImport(imported);
      else setWaiting(imported);
    } catch (err) {
      setFailure(err instanceof SyntaxError ? "That file is not valid JSON." : (err as Error).message);
    }
  }

  return (
    <TabScreen active="account">
      <h1 className="display">Account</h1>

      <div className="card row row--wide">
        <span className="avatar">
          <PersonIcon />
        </span>
        <div className="stack stack--tight">
          <div className="heading heading--small">No account yet</div>
          <div className="small muted">Signing in is not available yet. Your wardrobe is saved in this browser only.</div>
        </div>
      </div>

      <section className="stack stack--tight" aria-labelledby="data-heading">
        <h2 className="eyebrow eyebrow--muted" id="data-heading">
          Your data
        </h2>
        <div className="card menu">
          <button type="button" onClick={exportWardrobe} disabled={wardrobe.length === 0}>
            Export wardrobe as JSON
            <ChevronIcon />
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Import a wardrobe file
            <ChevronIcon />
          </button>
          <a href={link("welcome")}>
            Show the welcome screen
            <ChevronIcon />
          </a>
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="Wardrobe file" onChange={onFile} />
        <p className="tiny muted">
          {shirts(wardrobe.length)} in your wardrobe. The file uses the team's wardrobe format: id, label, garmentType and measurements in
          centimetres.
        </p>
      </section>

      {waiting && (
        <div className="card stack" role="group" aria-label="Replace wardrobe">
          <div className="heading heading--small">
            Replace your {shirts(wardrobe.length)} with the {waiting.length} in this file?
          </div>
          <div className="row">
            <button type="button" className="btn btn--outline btn--small btn--grow" onClick={() => setWaiting(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary btn--small btn--grow" onClick={() => applyImport(waiting)}>
              Replace
            </button>
          </div>
        </div>
      )}
      {done && (
        <div className="tip" role="status">
          {done}
        </div>
      )}
      {failure && <ErrorPanel title="Couldn't import this file">{failure}</ErrorPanel>}

      <ConfirmButton
        label="Reset wardrobe data"
        question="Delete every shirt and planned item saved in this browser?"
        confirmLabel="Delete"
        onConfirm={() => {
          resetAll();
          setWaiting(null);
          setFailure(null);
          setDone("Everything was deleted.");
        }}
      />

      <section className="stack stack--tight" aria-labelledby="legal-heading">
        <h2 className="eyebrow eyebrow--muted" id="legal-heading">
          About your data
        </h2>
        <div className="small muted">What Pearfit collects and how it is handled, and the terms for using it.</div>
        <div className="row">
          <a className="btn btn--outline btn--small btn--grow" href={`${API_BASE_URL}/privacy.html`} target="_blank" rel="noopener">
            Privacy notice<span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a className="btn btn--outline btn--small btn--grow" href={`${API_BASE_URL}/terms.html`} target="_blank" rel="noopener">
            Terms of use<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </section>

      <div className="spacer" />
      <p className="tiny muted center">
        Pearfit · version {__APP_VERSION__}
        <br />
        API: {API_BASE_URL.replace(/^https?:\/\//, "")}
      </p>
    </TabScreen>
  );
}
