/**
 * Representative central postcode per UK postcode area, used to fetch an
 * area-average long-let rent from PropertyData for the Market Explorer verdict.
 *
 * v1 SIMPLIFICATION: PropertyData's rental estimate needs a specific postcode,
 * so we use one central/representative postcode per area rather than averaging
 * many points across the area. This bounds PropertyData API calls to one per
 * area. Areas not listed here get no long-let comparator (the verdict then
 * degrades to "unavailable" rather than guessing). Extend as new areas appear.
 */
export const AREA_REPRESENTATIVE_POSTCODE: Record<string, string> = {
  BS: 'BS1 4DJ', // Bristol
  CT: 'CT1 2EH', // Canterbury
  DT: 'DT1 1UZ', // Dorchester
  GL: 'GL1 1PN', // Gloucester
  HG: 'HG1 1BH', // Harrogate
  HU: 'HU1 1AA', // Hull
  LE: 'LE1 5DR', // Leicester
  M: 'M1 1AE', // Manchester
  NE: 'NE1 5XU', // Newcastle upon Tyne
  NG: 'NG1 5DT', // Nottingham
  OX: 'OX1 1BP', // Oxford
  SA: 'SA1 1AA', // Swansea
  YO: 'YO1 7HH', // York
  // Common additional cities (in case they cross min_samples later):
  B: 'B1 1AA', // Birmingham
  L: 'L1 8JQ', // Liverpool
  LS: 'LS1 1BA', // Leeds
  S: 'S1 2HH', // Sheffield
  CF: 'CF10 1EP', // Cardiff
  EH: 'EH1 1BB', // Edinburgh
  G: 'G1 1XW', // Glasgow
};
