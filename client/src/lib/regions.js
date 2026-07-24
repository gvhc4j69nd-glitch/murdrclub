export const REGIONS = [
  { key: 'us-ne', name: 'Northeast US' },
  { key: 'us-se', name: 'Southeast US' },
  { key: 'us-mw', name: 'Midwest US' },
  { key: 'us-sw', name: 'Southwest US' },
  { key: 'us-w', name: 'West US' },
  { key: 'uk', name: 'United Kingdom' },
  { key: 'france', name: 'France' },
  { key: 'iberia', name: 'Portugal / Spain' },
  { key: 'ireland', name: 'Ireland' },
  { key: 'dach', name: 'Germany / Austria / Switzerland' },
  { key: 'nordic', name: 'Nordic Region' },
  { key: 'russia', name: 'Russia' },
  { key: 'eastern-europe', name: 'Eastern Europe' },
  { key: 'italy', name: 'Italy' },
  { key: 'baltics', name: 'Baltic States' },
  { key: 'africa', name: 'Africa' },
  { key: 'middle-east', name: 'Middle East' },
  { key: 'india', name: 'India' },
  { key: 'asia', name: 'Asia' },
  { key: 'australia', name: 'Australia' },
];

export function regionName(key) {
  return REGIONS.find(r => r.key === key)?.name || key;
}
