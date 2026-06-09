export type FacetValue = {
  value: string;
  count: number;
};

export type CategoryFacet = {
  slug: string;
  name: string;
  count: number;
};

export type OfferFacets = {
  cities: FacetValue[];
  stores: FacetValue[];
  categories: CategoryFacet[];
};
