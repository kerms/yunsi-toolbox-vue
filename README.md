# Yunsi Toolbox Vue

A collection of web-based tools with pure TypeScript parsing libraries and Vue 3 components.

## Structure

- `lib/` - Pure TypeScript libraries (no Vue dependency)
  - `shared/` - Binary read/write helpers, CRC32
  - `nvs/` - NVS partition parser, serializer, CSV support
  - `partition-table/` - ESP32 partition table parser/editor
  - `app-image/` - ESP32 app image header reader
- `components/` - Vue 3 components (depend on lib/)
  - `nvs-editor/` - NVS partition editor UI
  - `esp-flasher/` - Browser-based ESP32 flasher (Web Serial)
  - `partition-table-editor/` - Partition table editor UI
  - `app-image-viewer/` - App image info viewer

## Usage

This is intended to be used as a git submodule in Vue 3 projects.

```bash
git submodule add <repository-url> src/components/yunsi-toolbox-vue
```

### Third Party Licenses

- **esptools-js**: Licensed under the Apache License 2.0. Copyright (c) 2024 Espressif Systems (Shanghai) CO LTD.
