# Nowen Video User Guide

Nowen Video is a self-hosted media service for organizing and playing your home video library.

## Installation & Access

During installation, choose the profile matching your VOS host: `AMD64`, generic `ARM64`, or `l4t` for Jetson devices. After installation, open it from the VOS sidebar:

```text
Nowen Video
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

