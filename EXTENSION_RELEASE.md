# Chrome BODY Extension release

## Production artifact

Run:

```cmd
npm run clean
npm run extension:protected:test
```

This creates one Extension distributable:

```text
artifacts/BodyChromeAttach-v0.8.0.zip
```

The ZIP is already bundled, minified and obfuscated for offline distribution. There is no second unprotected ZIP, CRX release path, protection JSON, or protected staging directory.

## Package contents

The ZIP contains only:

```text
manifest.json
pairing.html
runtime-endpoint.json
service_worker.js
virtual_cursor_content.js
pairing_popup.js
```

It must contain no source tree, daemon code, `node_modules`, source maps, signing keys or remote code.

## Protection profile

Production JavaScript is built with:

- bundle/minify
- identifier mangling
- control-flow flattening
- dead-code injection
- encoded/split strings
- self-defending output
- Manifest V3 `browser-no-eval` target

The release contract rejects source maps, `eval()` and `new Function()`.

## Offline installation

Extract `BodyChromeAttach-v0.8.0.zip` to a permanent folder, then open:

```text
chrome://extensions/
```

Enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.

Real-Chrome release acceptance is manual only. Do not add Puppeteer, CDP browser automation, automatic Chrome launch, or automatic Extension installation.

## Clean build boundary

`dist/` is only a temporary build intermediate and is removed after the protected ZIP is created. `npm run clean` also removes legacy local `dist_protected/`, `release/`, `artifacts/`, `.release-build/` and `build/` directories.

The source repository never stores generated ZIP/CRX files, signing keys, Base64 binary payload parts or runtime logs.