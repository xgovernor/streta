import proj4 from "proj4";
import { register } from "ol/proj/proj4";
import { onCrsRegistered } from "../lib/gis/crs";

/**
 * OpenLayers resolves projections through its own registry, fed from proj4.
 * Re-registering on every new definition keeps data reading and the map in
 * agreement, including CRS codes carried by an opened project file.
 */
register(proj4);

onCrsRegistered(() => {
  register(proj4);
});
