# Chrome BODY Extension release

## Release artifact

Run:

```cmd
npm run extension:package
```

This creates:

```text
artifacts/body-chrome-attach-v<version>.zip
```

The ZIP is the production Extension deliverable. Development source under `src/`, daemon code, `node_modules`, source maps and signing keys are not included.

## Production build contents

The package contains only:

```text
manifest.json
pairing.html
runtime-endpoint.json
service_worker.js
virtual_cursor_content.js
pairing_popup.js
```

Manifest V3 requires distinct JavaScript entry files for the background service worker, content script and popup execution contexts. Each file above is a minified bundle; the original module tree is not shipped.

## Development build

For local debugging with source maps and remembered local runtime port:

```cmd
npm run build:dev
```

Do not use the development build as a release artifact.

## Release security

- Production packages contain no source maps.
- Production `runtime-endpoint.json` is inactive and contains no developer-machine port.
- `*.pem` signing keys and `*.crx` local output are ignored by Git and must not be committed.
- A signed CRX / Chrome Web Store publication step may consume the ZIP later, but release-key management is intentionally separate from the source repository.
