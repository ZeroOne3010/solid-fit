import { useRef, useState } from "react";
import { convertBatch, type BatchResult } from "../converter/convertBatch";
import { summarizeActivities } from "./importSummary";
import "./app.css";

const buildDate = new Date(__BUILD_TIMESTAMP__);
const buildTimestamp = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
}).format(buildDate);

const activityDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const activityTypeEmoji: Record<string, string> = {
  Cycling: "🚴",
  Running: "🏃",
  Walking: "🚶",
  Hiking: "🥾",
  Swimming: "🏊",
};

export function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<BatchResult>();
  const [cancelled, setCancelled] = useState(false);
  const cancelRef = useRef(false);
  const run = async () => {
    cancelRef.current = false;
    setCancelled(false);
    setStatus("Discovering GPX files…");
    try {
      const converted = await convertBatch(
        files,
        (current, total, name) =>
          setStatus(`Processing ${current + 1} of ${total}: ${name}`),
        () => cancelRef.current,
      );
      setResult(converted);
      setStatus("Conversion complete.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Conversion failed");
    }
  };
  const requestCancellation = () => {
    cancelRef.current = true;
    setCancelled(true);
    setStatus("Cancelling after the current file…");
  };
  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(result.blob),
      link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const startOver = () => {
    setResult(undefined);
    setFiles([]);
    setStatus("");
  };
  const summary = result ? summarizeActivities(result.activities) : undefined;
  const activityList = result && (
    <ul className="activity-list">
      {result.activities.map((activity) => (
        <li key={activity.id}>
          <b>{activity.name || activity.id}</b>
          <div className="activity-details">
            <span title={activity.type}>
              {activityTypeEmoji[activity.type] ?? activity.type}
            </span>
            <span>
              {activity.start
                ? activityDateTime.format(activity.start)
                : "Date unavailable"}
            </span>
            <span>
              {activity.averageSpeed === undefined
                ? "Avg speed unavailable"
                : `${activity.averageSpeed.toFixed(1)} km/h avg`}
            </span>
            <span>
              {activity.elevationGain === undefined
                ? "Elev. gain unavailable"
                : `${Math.round(activity.elevationGain)} m elev. gain`}
            </span>
            {activity.warnings > 0 && (
              <span className="activity-warning">
                ⚠️ {activity.warnings} warning
                {activity.warnings === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <main>
      <header>
        <p className="eyebrow">GPX → RDF</p>
        <h1>Solid Fit Converter</h1>
        <p>Turn GPX activities into portable RDF and a tidy ZIP export.</p>
        <p className="privacy-note">
          <strong>Private by design.</strong> Your activity files are processed
          locally in this browser and are not uploaded anywhere.
        </p>
      </header>
      <section>
        <label className="drop">
          <input
            type="file"
            accept=".gpx,.zip"
            multiple
            onChange={(event) => setFiles([...(event.target.files ?? [])])}
          />
          <span>Select GPX or ZIP files</span>
          <small>
            GPX files and ZIP archives containing GPX files are supported.
          </small>
        </label>
        <p>
          {files.length
            ? `${files.length} selected file${files.length === 1 ? "" : "s"}.`
            : "Choose one or more files to begin."}
        </p>
        <button disabled={!files.length} onClick={() => void run()}>
          Convert locally
        </button>
        {status && (
          <div className="status">
            {status}{" "}
            {status.includes("Processing") && (
              <button disabled={cancelled} onClick={requestCancellation}>
                Cancel
              </button>
            )}
          </div>
        )}
      </section>
      {result && summary && (
        <section>
          <h2>Export ready</h2>
          <div className="stats">
            <b>
              {result.activities.length}
              <small>converted</small>
            </b>
            <b>
              {result.duplicates}
              <small>duplicates</small>
            </b>
            <b>
              {result.failures.length}
              <small>failed</small>
            </b>
            <b>
              {summary.exerciseTypes}
              <small>exercise types</small>
            </b>
            <b>
              {summary.yearsCovered}
              <small>years covered</small>
            </b>
          </div>
          <button onClick={download}>
            Download ZIP ({Math.ceil(result.blob.size / 1024)} KB)
          </button>
          <button className="secondary" onClick={startOver}>
            Start over
          </button>
          {result.failures.length > 0 && (
            <details className="failures">
              <summary>
                {result.failures.length} failed file
                {result.failures.length === 1 ? "" : "s"} — show debug details
              </summary>
              {result.failures.map((failure) => (
                <p className="error" key={failure.path}>
                  <b>{failure.path}</b>
                  <br />
                  {failure.message}
                </p>
              ))}
            </details>
          )}
          {result.activities.length === 1
            ? activityList
            : result.activities.length > 1 && (
                <details className="activities">
                  <summary>
                    Show converted activities ({result.activities.length})
                  </summary>
                  {activityList}
                </details>
              )}
        </section>
      )}
      <footer>
        <span>
          Derived values use documented GPX calculations and may differ from
          Strava.
        </span>
        <span className="build-time" title={__BUILD_TIMESTAMP__}>
          Built {buildTimestamp}
        </span>
      </footer>
    </main>
  );
}
