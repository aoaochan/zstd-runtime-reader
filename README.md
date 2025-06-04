# zstd-runtime-reader
A tiny, zero-dependency **TypeScript** helper that lets browsers stream-decompress Zstandard (`*.zst`) “asset bundles” at run-time – perfect for WebGL/three.js games, demos, or any web-app that needs to keep large collections of **WebP, Ogg, glTF/GLB, BIN**, or other binary assets in a single file.

Internally it wraps a WebAssembly build of the companion Rust crate **`zstd-streaming-reader`** and exposes a clean, promise-based API.

---

## 📦 Creating .zst Packages
Need an archive to test with?  
Use the companion Rust CLI **[`zstd-encoder`](https://github.com/aoaochan/zstd-encoder)** to pack your assets – it outputs exactly the single-stream format this reader expects.

---

## ✨ Highlights
- **Instant random access** – list files and pull any entry without unpacking the rest.  
- **Typed helpers** – fetch bytes, `Blob`, object-URL, or UTF-8 text with one call.  
- **Autodetect MIME** for common game-ready formats (extendable).  
- **URL cache** with automatic `URL.revokeObjectURL` on `dispose()`.  
- **~40 kB JS + WASM** (gzipped) – minimal footprint, no external libs.  
- **Works everywhere** a modern ES2022 module works (Chrome, Firefox, Edge, Safari, PWAs…).