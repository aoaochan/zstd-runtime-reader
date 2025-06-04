/*
 * zstd-pack.ts — Minimal TypeScript helper around the wasm‑build of `zstd_streaming_reader`
 *
 * Features
 * ──────────────────────────────────────────────────────────────────────────────
 * • Open a .zst package produced by the project’s Rust encoder (single stream).
 * • List contained files.
 * • Read arbitrary entries as
 *     – raw Uint8Array           → getBytes()
 *     – Blob                     → getBlob()
 *     – object‑URL (blob:…)      → getURL()
 *     – UTF‑8 string             → getText()
 * • Simple MIME detection for *.webp, *.ogg, *.gltf, *.bin (extendable).
 * • URL cache + automatic revoke on dispose().
 *
 * Writing support (TODO)
 * ──────────────────────────────────────────────────────────────────────────────
 *  The current implementation focuses on *reading*.  To create / modify a Zstd
 *  package in the browser you’ll need an encoder (e.g. wasm build of
 *  `zstd-encoder`).  An API stub (encode) is left here for future work.
 */

/* eslint-disable @typescript-eslint/ban-ts-comment */
// Ensure your bundler/loader can resolve these paths (adjust as necessary)
// The .wasm glue is usually emitted next to the js wrapper inside the pkg zip.
import initWasm, { ZstdReader } from "./zstd-streaming-reader/zstd_streaming_reader.js";

// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// MIME table (extend as needed)
// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
const MIME_BY_EXT: Record<string, string> = {
  webp: "image/webp",
  ogg: "audio/ogg",
  gltf: "model/gltf+json",
  bin: "application/octet-stream",
};

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// Main helper class
// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
export class ZstPackage {
  /* ------------------------------------------------------------------------ */
  /* statics */
  /* ------------------------------------------------------------------------ */
  /**
   * Open a Zstd package from URL or ArrayBuffer.
   * @param source   URL string | ArrayBuffer | Uint8Array
   * @param wasmURL  Optionally specify the .wasm asset location (if not next to js glue)
   */
  static async open(
    source: string | ArrayBuffer | Uint8Array,
    wasmURL?: string,
  ): Promise<ZstPackage> {
    // 1. Initialise wasm once (idempotent)
    await ensureWasm(wasmURL);

    // 2. Acquire data
    let data: Uint8Array;
    if (typeof source === "string") {
      const resp = await fetch(source);
      if (!resp.ok) throw new Error(`Failed to fetch ${source}: ${resp.status}`);
      const buf = await resp.arrayBuffer();
      data = new Uint8Array(buf);
    } else if (source instanceof ArrayBuffer) {
      data = new Uint8Array(source);
    } else {
      data = source; // Uint8Array
    }

    return new ZstPackage(data);
  }

  /* ------------------------------------------------------------------------ */
  private reader: InstanceType<typeof ZstdReader>;
  private fileIndex: string[];
  private urlCache = new Map<string, string>(); // path -> blob URL

  private constructor(data: Uint8Array) {
    this.reader = new ZstdReader(data);
    const listJSON = this.reader.get_file_list(); // returns Uint8Array
    const listStr = new TextDecoder().decode(listJSON);
    this.fileIndex = JSON.parse(listStr);
  }

  /* ------------------------------------------------------------------------ */
  /* public API */
  /* ------------------------------------------------------------------------ */
  /** Array of file paths contained in the package */
  list(): readonly string[] {
    return this.fileIndex;
  }

  /** Get raw bytes of a file (Uint8Array copy) */
  getBytes(path: string): Uint8Array {
    this.assertPath(path);
    // wasm returns a freshly allocated Uint8Array each time — caller can mutate safely
    return this.reader.extract_file(path);
  }

  /** Get a Blob wrapping the bytes with a reasonable MIME type */
  getBlob(path: string): Blob {
    const bytes = this.getBytes(path);
    const mime = mimeFromPath(path);
    return new Blob([bytes], { type: mime });
  }

  /** Get (and cache) a blob: URL that can be fed to DOM / three.js loaders */
  async getURL(path: string): Promise<string> {
    if (this.urlCache.has(path)) return this.urlCache.get(path)!;
    const url = URL.createObjectURL(this.getBlob(path));
    this.urlCache.set(path, url);
    return url;
  }

  /** Convenience: treat bytes as UTF‑8 and return string */
  getText(path: string): string {
    return new TextDecoder().decode(this.getBytes(path));
  }

  /** Revoke all blob URLs and free wasm memory */
  dispose(): void {
    for (const url of this.urlCache.values()) URL.revokeObjectURL(url);
    this.urlCache.clear();
    this.reader.free();
  }

  /* ---------------------------------------------------------------------- */
  /* (WIP) Encoding stub — compile zstd-encoder to wasm and plug in here.    */
  /* ---------------------------------------------------------------------- */
  /**
   * Encode a set of files into a Zstd package.
   * Not implemented in this read‑only MVP.  Throws by default.
   */
  static async encode(/* files: Record<string, Uint8Array> */): Promise<Uint8Array> {
    throw new Error("Encode not implemented — build wasm for zstd-encoder and wire it up here.");
  }

  /* ------------------------------------------------------------------------ */
  /* internals */
  /* ------------------------------------------------------------------------ */
  private assertPath(path: string): void {
    if (!this.fileIndex.includes(path)) {
      throw new Error(`Path not found in package: ${path}`);
    }
  }
}

// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// wasm bootstrap helper (singleton)
// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
let wasmInit: Promise<void> | null = null;
async function ensureWasm(wasmURL?: string): Promise<void> {
  if (!wasmInit) {
    wasmInit = (async () => {
      // If caller supplied an explicit wasmURL use it, else let wasm‑bindgen
      // figure out the URL relative to the JS glue file.
      await initWasm(wasmURL ? { wasmBinaryPath: wasmURL } : undefined);
    })();
  }
  return wasmInit;
}

// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// Example usage (remove in production)
// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
/*
(async () => {
  const pkg = await ZstPackage.open("/assets.zst");
  console.log(pkg.list());

  const imgURL = await pkg.getURL("textures/hero.webp");
  const audioURL = await pkg.getURL("audio/bgm.ogg");

  const img = new Image();
  img.src = imgURL;
  document.body.appendChild(img);

  const audio = new Audio(audioURL);
  audio.loop = true;
  await audio.play();
})();
*/
