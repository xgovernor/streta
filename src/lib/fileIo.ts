/**
 * TODO:
 * - FileIO should be handled by the Rust backend instead of frontend for better performance.
 */

/**
 * File access that works both inside the Tauri shell and in a plain browser
 * build. In Tauri the native dialog and fs plugins are used; anywhere else the
 * browser's own file input and download path stands in. The plugins are
 * imported lazily so the web build never pulls them in.
 */

export interface OpenedTextFile {
  name: string;
  path: string | null;
  text: string;
}

export interface OpenedBinaryFile {
  name: string;
  path: string | null;
  bytes: Uint8Array;
}

/** A file the user picked, before it is known whether it holds text or bytes. */
export type OpenedFile = OpenedTextFile | OpenedBinaryFile;

export interface FileFilter {
  name: string;
  extensions: string[];
}

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function baseName(path: string): string {
  return path.replace(/^.*[\\/]/, "");
}

export async function openTextFile(
  filters: FileFilter[],
): Promise<OpenedTextFile | null> {
  if (isTauri()) {
    const [{ open }, { readTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const selected = await open({ multiple: false, directory: false, filters });

    if (typeof selected !== "string") {
      return null;
    }

    return {
      name: baseName(selected),
      path: selected,
      text: await readTextFile(selected),
    };
  }

  return pickBrowserFile(filters);
}

export async function saveTextFile(
  suggestedName: string,
  text: string,
  filters: FileFilter[],
  mime: string,
): Promise<string | null> {
  if (isTauri()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const target = await save({ defaultPath: suggestedName, filters });

    if (!target) {
      return null;
    }

    await writeTextFile(target, text);
    return target;
  }

  downloadInBrowser(suggestedName, text, mime);
  return suggestedName;
}

export async function writeTextFileAt(
  path: string,
  text: string,
): Promise<void> {
  if (isTauri()) {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, text);
    return;
  }

  downloadInBrowser(baseName(path), text, "application/json");
}

/** Reads a path the user granted earlier in this session, if it is still allowed. */
export async function readTextFileAt(path: string): Promise<string> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(path);
}

function pickBrowserFile(
  filters: FileFilter[],
): Promise<OpenedTextFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filters
      .flatMap((filter) =>
        filter.extensions.map((extension) => `.${extension}`),
      )
      .join(",");

    input.addEventListener("change", () => {
      const file = input.files?.[0];

      if (!file) {
        resolve(null);
        return;
      }

      file
        .text()
        .then((text) => resolve({ name: file.name, path: null, text }))
        .catch(reject);
    });

    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

function acceptAttribute(filters: FileFilter[]): string {
  return filters
    .flatMap((filter) => filter.extensions.map((extension) => `.${extension}`))
    .join(",");
}

function pickBrowserFiles(filters: FileFilter[]): Promise<OpenedFile[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = acceptAttribute(filters);

    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])];

      if (!files.length) {
        resolve([]);
        return;
      }

      Promise.all(
        files.map(async (file) => ({
          name: file.name,
          path: null,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      )
        .then(resolve)
        .catch(reject);
    });

    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

/**
 * Picks one or more dataset files as bytes. Selection is byte-shaped rather than
 * text-shaped because shapefiles and GeoPackages are binary, and because a
 * shapefile arrives as several related files that must be read together.
 */
export async function openDatasetFiles(
  filters: FileFilter[],
): Promise<OpenedFile[]> {
  if (isTauri()) {
    const [{ open }, { readFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const selected = await open({
      multiple: true,
      directory: false,
      filters,
    });

    const paths = typeof selected === "string" ? [selected] : (selected ?? []);

    return Promise.all(
      paths.map(async (path) => ({
        name: baseName(path),
        path,
        bytes: await readFile(path),
      })),
    );
  }

  return pickBrowserFiles(filters);
}

/** True when the picked file was already decoded to text. */
export function isTextFile(file: OpenedFile): file is OpenedTextFile {
  return "text" in file;
}

export function isBinaryFile(file: OpenedFile): file is OpenedBinaryFile {
  return "bytes" in file;
}

export function downloadInBrowser(
  fileName: string,
  text: string,
  mime: string,
): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
