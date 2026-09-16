# AIPOCH Network — Curated Open-Source Research Tools

Discover scientific computing libraries, analysis tools, and research workflows, organized by research task and linked to their original sources. This selection currently focuses on the Python research ecosystem.

[Browse the website](https://aipoch.network/) · [Suggest a resource](https://github.com/imjszhang/aipoch-network/issues/new/choose) · [Selection criteria](#selection-criteria)

## Contents

- [Scientific Computing & Data Analysis](#scientific-computing--data-analysis)
- [Statistics & Machine Learning](#statistics--machine-learning)
- [Data Visualization & Image Analysis](#data-visualization--image-analysis)
- [Bioinformatics & Single-Cell Analysis](#bioinformatics--single-cell-analysis)
- [Neuroscience & Neuroimaging](#neuroscience--neuroimaging)
- [Astronomy](#astronomy)
- [Mathematics & Network Analysis](#mathematics--network-analysis)
- [Research Workflows & Notebooks](#research-workflows--notebooks)
- [Research Guides](#research-guides)

## Scientific Computing & Data Analysis

- [NumPy](https://github.com/numpy/numpy) — Work with multidimensional arrays and numerical operations, providing a shared foundation for scientific Python libraries. [Details](https://aipoch.network/projects/project~numpy/)
- [pandas](https://github.com/pandas-dev/pandas) — Clean, combine, reshape, and analyze tabular data using labeled DataFrame and Series structures in Python. [Details](https://aipoch.network/projects/project~pandas/)
- [SciPy](https://github.com/scipy/scipy) — Apply numerical methods for optimization, integration, statistics, signal processing, and linear algebra on top of NumPy. [Details](https://aipoch.network/projects/project~scipy/)
- [Xarray](https://github.com/pydata/xarray) — Analyze multidimensional datasets with named dimensions and coordinates, making array operations easier to relate to scientific measurements. [Details](https://aipoch.network/projects/project~xarray/)

## Statistics & Machine Learning

- [scikit-learn](https://github.com/scikit-learn/scikit-learn) — Build machine-learning workflows for classification, regression, and clustering, with preprocessing, model selection, and evaluation tools. [Details](https://aipoch.network/projects/project~scikit-learn/)
- [Statsmodels](https://github.com/statsmodels/statsmodels) — Fit statistical models, run hypothesis tests, and explore relationships in data, including regression and time-series analysis. [Details](https://aipoch.network/projects/project~statsmodels/)

## Data Visualization & Image Analysis

- [Matplotlib](https://github.com/matplotlib/matplotlib) — Create and customize scientific plots in Python, with control over axes, annotations, and publication-oriented figure layouts. [Details](https://aipoch.network/projects/project~matplotlib/)
- [scikit-image](https://github.com/scikit-image/scikit-image) — Process images with Python algorithms for filtering, segmentation, feature extraction, and measurement in scientific analysis workflows. [Details](https://aipoch.network/projects/project~scikit-image/)
- [seaborn](https://github.com/mwaskom/seaborn) — Explore statistical relationships through high-level plots built on Matplotlib, with support for grouping variables and comparing distributions. [Details](https://aipoch.network/projects/project~seaborn/)

## Bioinformatics & Single-Cell Analysis

- [AnnData](https://github.com/scverse/anndata) — Organize annotated data matrices with observation and variable metadata, separating single-cell data representation from downstream analysis methods. [Details](https://aipoch.network/projects/project~anndata/)
- [Biopython](https://github.com/biopython/biopython) — Work with biological sequences, common bioinformatics file formats, and biological databases through reusable Python modules and interfaces. [Details](https://aipoch.network/projects/project~biopython/)
- [MuData](https://github.com/scverse/mudata) — Organize multimodal datasets as collections of AnnData objects, with data structures and file I/O for linked modalities. [Details](https://aipoch.network/projects/project~mudata/)
- [Scanpy](https://github.com/scverse/scanpy) — Analyze single-cell gene expression data with preprocessing, dimensionality reduction, clustering, and visualization tools built around AnnData. [Details](https://aipoch.network/projects/project~scanpy/)

## Neuroscience & Neuroimaging

- [MNE-Python](https://github.com/mne-tools/mne-python) — Analyze electrophysiology recordings such as EEG and MEG, with tools for preprocessing, visualization, and source estimation. [Details](https://aipoch.network/projects/project~mne-python/)
- [NiBabel](https://github.com/nipy/nibabel) — Read and write neuroimaging file formats, accessing image arrays and metadata for use in downstream analysis tools. [Details](https://aipoch.network/projects/project~nibabel/)
- [Nilearn](https://github.com/nilearn/nilearn) — Analyze neuroimaging data with statistical learning, including tools for extracting signals, fitting models, and visualizing results. [Details](https://aipoch.network/projects/project~nilearn/)

## Astronomy

- [Astropy](https://github.com/astropy/astropy) — Work with astronomical coordinates, physical units, time representations, and common data formats through a shared Python core library. [Details](https://aipoch.network/projects/project~astropy/)

## Mathematics & Network Analysis

- [NetworkX](https://github.com/networkx/networkx) — Create and analyze graphs, using network algorithms to study connectivity, paths, and structural properties of linked data. [Details](https://aipoch.network/projects/project~networkx/)
- [SymPy](https://github.com/sympy/sympy) — Manipulate symbolic expressions and perform algebra, calculus, and equation solving when exact symbolic relationships matter alongside numerical results. [Details](https://aipoch.network/projects/project~sympy/)

## Research Workflows & Notebooks

- [Jupyter Notebook](https://github.com/jupyter/notebook) — Explore research interactively in a browser-based notebook that combines executable code, explanatory text, visualizations, and computational output. [Details](https://aipoch.network/projects/project~jupyter-notebook/)
- [Snakemake](https://github.com/snakemake/snakemake) — Define analysis workflows as rules with file dependencies, helping organize execution from local machines to larger computing environments. [Details](https://aipoch.network/projects/project~snakemake/)

## Research Guides

- [Getting started](docs/guides/getting-started.md) — Find resources through AIPOCH Network and follow their original documentation.
- [Python single-cell analysis resources](docs/guides/python-single-cell.md) — Understand tool roles, data structures, and research records before choosing an analysis path.

These are resource guides, not tested end-to-end analysis tutorials. See the [guide index](docs/guides/README.md) for their review scope and dates.

## Selection Criteria

We select resources for a clear research use, identifiable upstream sources, accessible documentation, and an open-source license reviewed at the source. Each entry should explain a distinct use or role; stars alone do not determine inclusion. Maintenance status and source changes inform subsequent reviews.

This is an editorial selection, not a benchmark or a validated software environment. Inclusion does not imply maintainer approval, organizational endorsement, or scientific validation. Check each project's current documentation, license, and requirements before use. Source and license review: September 16, 2026.

## Contribute

[Suggest a resource or correction](https://github.com/imjszhang/aipoch-network/issues/new/choose) with a public GitHub URL. A sentence explaining its research use is helpful but optional. No special manifest, Topics, installed client, or AIPOCH account is required to propose a candidate.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for review and contribution guidance. Candidate submission, catalog inclusion, and selection for this README are separate decisions. Report broken links or stale descriptions; discuss upstream software and methods with their original projects.

## About AIPOCH

AIPOCH Network connects research projects, reusable capabilities, and their sources. This list is one entry point into that broader network. Use the [website](https://aipoch.network/) to search and browse related projects and capabilities without signing in or installing a client. Code, documentation, authorship, and collaboration remain upstream.

For the website's source code and public interfaces, see [Development](docs/development.md), the [Catalog Contract](docs/catalog-contract.md), and the [Consumer Guide](docs/consumer-guide.md).

## License

Original code and corresponding documentation are licensed under [MIT](LICENSE). Listed projects, third-party content, and design references retain their own licenses and rights.
