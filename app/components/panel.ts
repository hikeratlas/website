// The desktop panel (CuratedRoutes' Sheet, and the /hikes page's summary
// before the map is up): a box at the map's bottom right, bottom-8.
//
// Its height at most: its top stays 10 px below the map's top-right buttons
// (geolocate and imagery, which end 78 px down), so a tall panel never
// covers them (#171). 32 (bottom-8) + 78 + 10.
export const DESKTOP_PANEL_MAX_H = 'calc(100% - 120px)';
