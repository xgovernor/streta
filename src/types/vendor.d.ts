/**
 * Ambient declarations for the two readers that ship no types of their own, and
 * for Vite's `?url` asset imports. Only the surface this project uses is
 * declared, so a library upgrade that changes it fails the typecheck.
 */

declare module "*.wasm?url" {
  const url: string;
  export default url;
}

/** A JSON asset referenced by URL, so the library can fetch it lazily. */
declare module "*.json?url" {
  const url: string;
  export default url;
}

declare module "shpjs" {
  export interface ShapefileGeoJson {
    type: string;
    features: unknown[];
    fileName?: string;
  }

  /** Zips must be parsed asynchronously; loose parts are combined synchronously. */
  export function parseZip(
    buffer: ArrayBuffer | Uint8Array | DataView,
    whiteList?: string[],
  ): Promise<ShapefileGeoJson | ShapefileGeoJson[]>;

  export function parseShp(buffer: DataView, projection?: unknown): unknown[];
  export function parseDbf(
    buffer: ArrayBuffer | Uint8Array,
    codePage?: ArrayBuffer | Uint8Array,
  ): Record<string, unknown>[];
  export function combine(parts: unknown[]): ShapefileGeoJson;

  export default function getShapefile(
    base: unknown,
    whiteList?: string[],
  ): Promise<ShapefileGeoJson | ShapefileGeoJson[]>;
}

declare module "sql.js" {
  export interface SqlJsStatement {
    bind(values: unknown[]): boolean;
    step(): boolean;
    get(): unknown[];
    getColumnNames(): string[];
    free(): void;
  }

  export interface SqlJsDatabase {
    exec(sql: string): { columns: string[]; values: unknown[][] }[];
    run(sql: string, params?: unknown[]): void;
    prepare(sql: string, params?: unknown[]): SqlJsStatement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
