# Solid Fit Converter

A static, browser-only GPX converter. It creates a ZIP with byte-identical GPX source files, Turtle RDF activity documents, and `fitness/manifest.json`. **Your activity files are processed locally in this browser and are not uploaded anywhere.**

## Development

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

Deploy `dist` to GitHub Pages; Vite uses a relative base so it works under a repository subpath. Supported input is GPX and ZIP archives containing GPX files. The export groups files by the activity UTC year in `fitness/activities/<year>` and `fitness/source-files/<year>`.

RDF uses `schema:ExerciseAction`, relative source links, and `schema:Observation` values. Distances use Haversine. Moving time uses segment-local sustained-stop detection (1 km/h entry, 2 km/h exit, 10-second dwell, and 6–8 m radius hysteresis); maximum speed uses validated centred three-point estimates. Results may differ from fitness platforms. Current limits: GPX only (no FIT/TCX), no Pod upload, no maps. Planned components are Solid Fit Converter, Solid Fit Uploader, and Solid Fit Browser.
