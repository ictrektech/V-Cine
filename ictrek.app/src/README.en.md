# Nowen Video User Guide

Nowen Video is a self-hosted media service for organizing and playing your home video library.

## Installation & Access

During installation, choose the `AMD64` or `ARM64` profile matching your VOS host architecture. After installation, open it from the VOS sidebar:

```text
Nowen Video -> Home Media
```

## Data Directory

The default host persistence root is:

```text
/data/vos_workspace/nowen
```

Layout:

```text
/data/vos_workspace/nowen/
├── data/   # SQLite database, config, and login keys
├── cache/  # transcoding cache
└── media/  # optional VOS-managed media directory; /media inside the container
```

The first user registered on first launch becomes the administrator. The library can point at the in-container `/media` directory, or at a supported remote storage configured inside the app.

`NOWEN_ADULT_SCRAPER_ENABLED` is off by default; enable it only when there is a real business need and it complies with local regulations.
