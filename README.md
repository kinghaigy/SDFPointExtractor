# SDF Point Extractor (Browser Local)

This project is a browser-based app for extracting survey points from Autodesk Map3D `.sdf` files and exporting locally to:

- Emlid-compatible CSV
- BricsCAD-friendly CSV
- GeoJSON
- Optional DXF (point entities)

## Privacy Model

- Processing runs in your browser on your machine.
- No survey rows are uploaded to any server.
- The app has no backend API.

## Run Locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Build

```bash
npm run build
npm run preview
```

## Publish on GitHub Pages

This project includes a workflow at `.github/workflows/deploy-pages.yml` that builds and deploys `dist/` to GitHub Pages on every push to `main`.

1. Create a new empty GitHub repository.
2. Initialize git locally in this folder (if needed):

```bash
git init
git branch -M main
git add .
git commit -m "Initial commit: SDF extractor app"
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

3. In GitHub: `Settings -> Pages -> Build and deployment -> Source = GitHub Actions`.
4. Pushes to `main` will automatically deploy the site.

Notes:
- The app uses relative asset paths and is compatible with GitHub Pages hosting.
- First deployment can take a couple of minutes.

## Workflow

1. Load an SDF file from disk.
2. Review detected candidate tables and field mappings.
3. Rebuild mapped points if you adjust mappings.
4. Export target formats.

## Notes

- Autodesk SDF files are SQLite-backed in many Map3D workflows.
- Auto-mapping uses name heuristics. If your schema is unusual, use manual mapping controls.
- If CRS metadata is missing, verify output coordinates in your target tool before production use.

## Compatibility Caveat (Important)

Some Autodesk Survey SDF datasets store records in proprietary blob-backed tables (for example `DATA_SurveyPoint(data blob)`) and use non-standard SQLite characteristics. Generic browser SQLite engines cannot decode those feature blobs directly.

This app now includes a built-in fallback decoder for that Autodesk blob layout. When standard browser SQLite open fails, it attempts direct page parsing and point extraction from `DATA_SurveyPoint` blobs.

If fallback extraction is not successful for a particular SDF variant, the local-only workaround is:

1. Export survey points from Autodesk tools to CSV, LandXML, SHP, or standard SQLite.
2. Re-import that exported file into this app workflow for Emlid/BricsCAD/GeoJSON output formatting.
