# Developing AIPOCH Network

[Back to the resource list](../README.md)

The website, catalog pipeline, public contracts, and reference consumer are maintained in this repository. The website is hosted on GitHub Pages at [aipoch.network](https://aipoch.network/); it does not require a self-hosted backend or any particular client to operate.

Use Node **24.18.1**, as pinned in `.node-version`:

```sh
npm ci
npm run catalog:build
npm run dev
```

The initial offline catalog uses reviewed pilot fixtures, not live upstream state. Run `npm run check` for types, tests, and the static build; install Chromium with `npx playwright install chromium` before `npm run test:e2e`. The read-only `npm run catalog:refresh` fetches public GitHub data into a local cache for a subsequent build.

Default builds use an unavailable client adapter. The separate `npm run build:demo` output simulates interactions and is labelled Demo. `npm run build:real` builds the Connector transport, but pairing still requires a running Connector and local approval. See [Connector integration](connector-adapter.md) for supported environments and [workbench preview](workbench-preview.md) for preview commands.

| Documentation | Purpose |
| --- | --- |
| [Architecture and decisions](architecture.md) | Module boundaries and design decisions |
| [Public catalog contract](catalog-contract.md) · [Field specifications](../spec/README.md) | Data model, provenance, versions, and public interfaces |
| [Consumer guide](consumer-guide.md) | Read the catalog from an independent client |
| [Automation](automation.md) | Checks, trusted refreshes, and publication workflows |
| [Connector integration](connector-adapter.md) | Integration scope, environments, and verified limitations |
| [Implementation status](implementation-status.md) · [v9-r2 verification](verification/v9-r2/implementation-status.md) | Delivery evidence and remaining work |
| [Deployment](deployment/public-pages.md) · [Operations](delivery-operations.md) | Hosting and operational procedures |
| [Design handoff](../design/README.md) · [Explore design synchronization](../design/changes/explore-dates-metrics-handoff.md) | Design references and implementation guidance |

