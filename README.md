# AIPOCH Network

An open research network connecting research projects, reusable capabilities, and their original GitHub sources.

[Explore AIPOCH Network](https://aipoch.network/) · [Research guides](docs/guides/README.md) · [Contribute](CONTRIBUTING.md) · [简体中文](README.zh-CN.md)

AIPOCH Network helps researchers discover scientific software and research resources, understand their purpose and provenance, and continue to the original project or an independent research client. Code, documentation, authorship, and collaboration stay with their upstream projects.

## What you can do today

- **Discover research projects and capabilities.** Browse and search the [public network](https://aipoch.network/explore/) without signing in or installing a desktop client.
- **Follow the sources.** Explore project and resource relationships, then visit the original repositories and documentation to check versions, licenses, and usage requirements.
- **Contribute a public source or correction.** An existing GitHub project can be proposed with a public URL. No special manifest, Topics, AIPOCH account, or project modification is required for basic consideration.
- **Build an independent consumer.** Read the [versioned public catalog](docs/catalog-contract.md) using the [consumer guide](docs/consumer-guide.md).

Community inclusion does not imply maintainer approval, organizational endorsement, or scientific validation. Authentication, local research execution, and client-specific integrations belong to independent clients and the Connector; browsing this website does not require them.

## Research guides

These guides organize sources, selection considerations, and research-record suggestions. They are not validated end-to-end analysis tutorials.

| Guide | Language | Purpose |
| --- | --- | --- |
| [Getting started](docs/guides/getting-started.zh-CN.md) | 简体中文 | Navigate from the public network to original research resources |
| [Python single-cell analysis resources](docs/guides/python-single-cell.zh-CN.md) | 简体中文 | Understand AnnData, Scanpy, and related resource roles, and keep reviewable research records |

See the [guide index](docs/guides/README.md) for scope and source-review dates. Candidate resources and resources already in the catalog are explicitly distinguished in each guide.

## Contribute

Use the [contribution guide](CONTRIBUTING.md) and [issue forms](https://github.com/imjszhang/aipoch-network/issues/new/choose) to suggest a project, correct information, report a problem, or propose an improvement. Keep private data and credentials out of public issues and pull requests.

## For developers

The website, catalog pipeline, public contracts, and reference consumer are maintained in this repository. The website is hosted on GitHub Pages at [aipoch.network](https://aipoch.network/); it does not require a self-hosted backend or any particular client to operate.

Use Node **24.18.1**, as pinned in `.node-version`:

```sh
npm ci
npm run catalog:build
npm run dev
```

The initial offline catalog uses reviewed pilot fixtures, not live upstream state. See [local development and verification](README.zh-CN.md#本地开发) for checks, refresh commands, and separate default, demo, and real Connector modes.

| Documentation | Purpose |
| --- | --- |
| [Architecture and decisions](docs/architecture.md) | Module boundaries and design decisions |
| [Public catalog contract](docs/catalog-contract.md) · [Field specifications](spec/README.md) | Data model, provenance, versions, and public interfaces |
| [Consumer guide](docs/consumer-guide.md) | Read the catalog from an independent client |
| [Automation](docs/automation.md) | Checks, trusted refreshes, and publication workflows |
| [Connector integration](docs/connector-adapter.md) | Integration scope, environments, and verified limitations |
| [Implementation status](docs/implementation-status.md) · [v9-r2 verification](docs/verification/v9-r2/implementation-status.md) | Delivery evidence and remaining work |
| [Deployment](docs/deployment/public-pages.md) · [Operations](docs/delivery-operations.md) | Hosting and operational procedures |
| [Design handoff](design/README.md) · [Explore design synchronization](design/changes/explore-dates-metrics-handoff.md) | Design references and implementation guidance |
| [中文项目说明](README.zh-CN.md) | Product principles, repository structure, and detailed historical context |

## License

Original code and corresponding documentation are licensed under [MIT](LICENSE). Upstream project content, original design references, and third-party dependencies retain their own licenses and rights. A catalog entry's license information describes its upstream source.
