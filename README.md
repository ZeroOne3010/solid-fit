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

RDF uses `schema:ExerciseAction`, relative source links, and `schema:Observation` values. Distances use Haversine and moving time uses a 0.5 m/s threshold with a 30-second gap cap; results may differ from Strava. Current limits: GPX only (no FIT/TCX), no Pod upload, no maps. Planned components are Solid Fit Converter, Solid Fit Uploader, and Solid Fit Browser.
