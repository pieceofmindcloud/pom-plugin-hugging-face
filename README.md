# Hugging Face

A POM plugin (`plugin_code: huggingface`): a native `cdylib` loaded by
`pom-plugin-host`, with its own menu, screens and i18n embedded in the binary.

It adds **Search Models** to the menu: one screen with three tabs - search
Hugging Face and download a GGUF to this machine or another one, follow the
downloads of every machine, and set the access token. The work behind each tab
stays in the POM node (`/api/ui/model-provider/*` and `/api/ui/jobs`); the
screen calls it with the panel's session through the host SDK (`api.get`, and
`api.post` from host version 8). Without the plugin the POM has no search
screen; the Models screen and "Download here" in a deploy keep working.

## Layout

| Path | What it is |
|---|---|
| `src/abi.rs` | C ABI v1 boundary (`create`, `ingest`, `query`, `free_buffer`, `shutdown`) |
| `src/lib.rs` | entry `pom_huggingface_plugin_v1` and the operation dispatch |
| `src/context.rs` | `host.configure`: gateway, workspace root, host API, preferences |
| `ui/manifest.json` | `pom-plugin-ui/v1`: menu, routes, screens, i18n, docs, assets |
| `ui/src/host/` | the only code that reads `__POM_HOST__` (SDK helpers, `ready()`) |
| `ui/src/screens/` | one export per screen named in the manifest (`models`: Search, Downloads, Settings tabs) |
| `ui/src/api.ts` | the node's model provider routes the screen calls, and the public trending list |
| `i18n/` | catalogs with bare keys; the build prefixes `huggingface.` |
| `release/manifest.json` | release contract: ABI, `feature_set`, preferences schema |
| `scripts/` | UI build, native build, packaging, CI plan, license server upload |
| `tests/contract.rs` | static contract checks of both manifests |
| `docs/` | the guide shown in POM's Documentation, and `screenshots/` for the Plugins store card |
| `LICENSE` | MIT |

## Build and verify

```bash
scripts/build-ui.sh
POM_UI_REQUIRE_DIST=1 cargo test --locked
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
tests/test_ci_plan.sh
scripts/package.sh --platform linux-x86_64 --version 0.1.0
```

`scripts/package.sh` writes `dist-release/pom-plugin-hugging-face-<platform>.<ext>`, its
metadata and `pom-plugin-<platform>.json`, the manifest a GitHub release
attaches so the POM can install it from **Plugins > Add from GitHub**.

## Release

Run the **Publish plugin release** workflow with the platforms and a
`vX.Y.Z` tag per platform. A prerelease stays on GitHub; a stable release is
also uploaded to the license server (`POM_RELEASE_TOKEN`, `POM_RELEASE_API`
secrets), the POM's fallback when GitHub refuses or rate-limits.

## Local development in a POM node

With `POM_DEV_MODE=1` and this repository mounted next to the POM (under
`/opt/pom/dev-plugins`), **Plugins** offers a rebuild that runs the
`development.rebuild` steps of `ui/manifest.json`, then `cargo build`, and
installs the result without a license.

## License and trademarks

The plugin is MIT licensed (`LICENSE`).

Hugging Face and the Hugging Face logo are trademarks of Hugging Face, Inc.
This plugin is an independent project of the POM authors: it is not affiliated
with, sponsored or endorsed by Hugging Face, Inc. It uses the public Hugging
Face Hub API (through the POM node, and the public trending list straight from
the browser) under the Hub's terms; the models it downloads keep their own
licenses, which the screen shows before a download. GGUF is the file format of
the llama.cpp project.
