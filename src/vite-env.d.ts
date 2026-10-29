/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly GOOGLE_MAPS_API_KEY?: string;
  readonly CESIUM_ION_TOKEN?: string;
  readonly TOMTOM_API_KEY?: string;
  readonly FIRMS_MAP_KEY?: string;
  readonly AISSTREAM_API_KEY?: string;
  readonly OPENSKY_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
