import { useRef, useState } from 'react';
import { convertBatch, type BatchResult } from '../converter/convertBatch';
import './app.css';

export function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<BatchResult>();
  const [cancelled, setCancelled] = useState(false);
  const cancelRef = useRef(false);

  const run = async () => {
    cancelRef.current = false;
    setCancelled(false);
    setStatus('Discovering GPX files…');
    try {
      const converted = await convertBatch(
        files,
        (current, total, name) => setStatus(`Processing ${current + 1} of ${total}: ${name}`),
        () => cancelRef.current,
      );
      setResult(converted);
      setStatus('Conversion complete.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Conversion failed');
    }
  };

  const requestCancellation = () => {
    cancelRef.current = true;
    setCancelled(true);
    setStatus('Cancelling after the current file…');
  };

  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return <main><header><p className="eyebrow">PRIVATE, BROWSER-ONLY</p><h1>Solid Fit Converter</h1><p>Turn GPX activities into portable RDF and a tidy ZIP export.</p></header><section><strong>Your activity files are processed locally in this browser and are not uploaded anywhere.</strong><label className="drop"><input type="file" accept=".gpx,.zip" multiple onChange={(event) => setFiles([...event.target.files ?? []])}/><span>Select GPX or ZIP files</span><small>GPX files and ZIP archives containing GPX files are supported.</small></label><p>{files.length ? `${files.length} selected file${files.length === 1 ? '' : 's'}.` : 'Choose one or more files to begin.'}</p><button disabled={!files.length} onClick={() => void run()}>Convert locally</button>{status && <div className="status">{status} {status.includes('Processing') && <button disabled={cancelled} onClick={requestCancellation}>Cancel</button>}</div>}</section>{result && <section><h2>Export ready</h2><div className="stats"><b>{result.activities.length}<small>converted</small></b><b>{result.duplicates}<small>duplicates</small></b><b>{result.failures.length}<small>failed</small></b></div><button onClick={download}>Download ZIP ({Math.ceil(result.blob.size / 1024)} KB)</button><button className="secondary" onClick={() => { setResult(undefined); setFiles([]); setStatus(''); }}>Start over</button>{result.failures.map((failure) => <p className="error" key={failure.path}>{failure.path}: {failure.message}</p>)}<ul>{result.activities.map((activity) => <li key={activity.id}><b>{activity.name || activity.id}</b><br/>{activity.type} · {(activity.distance / 1000).toFixed(2)} km · {activity.warnings} warnings</li>)}</ul></section>}<footer>Derived values use documented GPX calculations and may differ from Strava.</footer></main>;
}
