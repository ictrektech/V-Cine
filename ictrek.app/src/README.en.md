# Nowen Video User Guide

Nowen Video is a self-hosted media service for organizing and playing your home video library.

## Installation & Access

During installation, choose the profile matching your VOS host: `AMD64`, generic `ARM64`, or `l4t` for Jetson devices. After installation, open it from the VOS sidebar:

```text
Nowen Video -> Home Media
```

## Storage Directory

Choose one unified storage root during installation. The default is:

```text
/data/vos_workspace/nowen_video
```

You can also select a VOS public directory. The app template automatically uses these subdirectories under the selected root, so they do not need separate configuration:

```text
/data/vos_workspace/nowen_video/
├── data/   # SQLite database, config, and login keys
├── cache/  # transcoding cache
└── media/  # media directory; /media inside the container
```

The first user registered on first launch becomes the administrator. The library can point at the in-container `/media` directory, or at a supported remote storage configured inside the app.

`NOWEN_ADULT_SCRAPER_ENABLED` is off by default; enable it only when there is a real business need and it complies with local regulations.
