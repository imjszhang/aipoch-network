# Python single-cell analysis: tools, data structures, and research records

Resource guide for researchers who can read Python notebooks. Original review: September 14, 2026; English adaptation: September 16, 2026.

When you receive an expression matrix, first document where it came from: its samples, cells, genes, prior processing, and the question you intend to answer. Keep this alongside software versions, parameters, and the reasons behind your choices so another researcher can understand the work.

Tool descriptions below draw on maintainer documentation. The suggested reading order and research records are our editorial guidance. We did not run these tools or validate a combined environment, and this guide does not scientifically validate any result.

At the September 14 review, the catalog included [AnnData](https://aipoch.network/capabilities/resource~anndata-library/), [Scanpy](https://aipoch.network/capabilities/resource~scanpy-library/), and [MuData](https://aipoch.network/capabilities/resource~mudata-library/). The other nine tools were research candidates. This dated distinction is preserved from the original guide, not presented as a fresh inventory check. See the [reviewed source snapshot](https://aipoch.network/catalog/v1/snapshots/783da3beb22610ad5d9e3e2b/sources-0.json).

## Understand the data object

AnnData stores annotated matrix data. In its single-cell introduction, rows represent cells and columns represent genes; `.obs` holds observation annotations and `.var` holds variable annotations. See the [AnnData introduction](https://anndata.readthedocs.io/en/stable/tutorials/notebooks/getting-started.html).

Create a short data note covering the source, version, acquisition date, meaning of each axis, sample and batch fields, and whether values are counts or transformed measurements. Mark anything you cannot establish as unknown. A file format alone does not prove what a field means.

For example, a field named `batch` may represent different processing stages in different datasets. Read the data dictionary before explaining an integration choice, and retain revisions when annotations are corrected.

## Start with a clear analysis question

[Scanpy](https://github.com/scverse/scanpy) provides single-cell expression analysis, including preprocessing, visualization, and clustering. It uses AnnData, but the two resources have distinct roles: analysis capabilities and annotated data organization.

Start by reading an upstream example to understand its inputs, parameters, and outputs. For your own data, record what each step checks, which fields it uses, how many cells or features it changes, and why a threshold was selected. These are record-keeping suggestions, not universal analysis parameters.

Keep the input version, step order, parameters, and result objects alongside figures. This helps locate what must be rerun after an annotation correction. Visual separation alone should not be treated as confirmation of cell identity.

## Add models and evaluation when the question requires them

[scvi-tools](https://github.com/scverse/scvi-tools) provides probabilistic models for single-cell omics. Select a question and model before checking its inputs and interface. A project's integration capabilities do not prove compatibility with your particular data.

A model-selection note can record the objective, required inputs, training-data scope, parameters, randomness, dependencies, environment, and evaluation approach. Compatibility claims should come from the selected version's documentation and actual testing.

[scIB](https://github.com/theislab/scib) provides tools for integration analysis and evaluation. Its package, separate pipeline, and research-reproduction materials should be read as distinct resources.

Before evaluation, specify which biological structure should be preserved, which batch differences should be addressed, and what each metric measures. A visualization or aggregate score does not replace these decisions. Retain dataset and version boundaries when citing a benchmark; this guide offers no new benchmark or “best method” ranking.

## Choose extensions by data and research question

You do not need to install an entire ecosystem to begin with an expression matrix. Use these branches to identify the next documentation to read, then review each method's inputs separately.

| Question | Resources to explore | Check first |
| --- | --- | --- |
| How should multiple modalities be organized and analyzed? | [MuData](https://github.com/scverse/mudata), [muon](https://github.com/scverse/muon) | MuData is a container and I/O library; muon is an analysis framework built around it |
| How can omics results be interpreted through enrichment methods? | [decoupler](https://github.com/scverse/decoupler) | Method and prior-resource sources, versions, and licenses |
| Does the dataset include TCR/BCR information? | [Scirpy](https://github.com/scverse/scirpy) | Whether receptor information exists and how it maps to cells |
| Is this a perturbation experiment? | [Pertpy](https://github.com/scverse/pertpy) | Conditions, controls, and metadata required by the selected analysis |
| Is the question about cellular dynamics? | [scVelo](https://github.com/theislab/scvelo), [CellRank](https://github.com/scverse/cellrank) | Required inputs and assumptions, and how inference should be described |
| Are spatial positions or images available? | [Squidpy](https://github.com/scverse/squidpy) | Provenance and correspondence of spatial data and images |

Purposes are based on maintainer descriptions; the reading order and input checks are editorial suggestions. Except for MuData, these extension resources were candidates at the original review. Their inclusion here does not imply catalog inclusion or maintainer endorsement of this guide.

## Keep the evidence findable

At each useful stage, retain a short record:

1. **Inputs:** source, version, acquisition date, checksums where applicable, and access conditions. Keep sensitive data in authorized locations.
2. **Methods:** software and dependency versions, upstream documentation, actual parameters, step order, and necessary environment details.
3. **Outputs:** the run associated with each file or figure, including failed or unexecuted steps.
4. **Interpretation:** distinguish direct results from explanations, assumptions, and evidence still needed.

Complete records make review easier, but do not replace reproduction, method evaluation, or scientific validation. Use your team's existing process when possible rather than maintaining conflicting copies.

AIPOCH Network helps readers discover resources, inspect their sources, and return upstream. Browsing does not require a workbench, and source code, documentation, and collaboration remain with the original projects. See the [project overview](../../README.md).

A useful first action is to write a data note for one matrix and choose one basic analysis question. The gaps you encounter can inform the next resource guide.

Continue with [Getting started](getting-started.md), or report a specific link, source, or wording issue through [Network Issues](https://github.com/imjszhang/aipoch-network/issues).
