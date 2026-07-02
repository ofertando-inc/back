// A geocoded location suggestion derived from a Nominatim/OSM result, shaped
// for the store-creation flow (the front pre-fills name/address from it).
export type GeocodeSuggestion = {
  displayName: string;
  latitude: number;
  longitude: number;
  city: string | null;
  region: string | null;
  address: string | null;
};
