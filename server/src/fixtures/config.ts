/**
 * Fixed tables for the dev fixture generator.
 *
 * The 15 cities and their coordinates match TRD section 11, which says the
 * generator holds a fixed table of about 15 Indian cities. Keeping them here
 * means the same list can be lifted into ml/generate.py unchanged.
 */
export interface City {
  city: string;
  lat: number;
  lng: number;
}

export const CITIES: readonly City[] = [
  { city: 'Mumbai', lat: 19.076, lng: 72.8777 },
  { city: 'Delhi', lat: 28.6139, lng: 77.209 },
  { city: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { city: 'Hyderabad', lat: 17.385, lng: 78.4867 },
  { city: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { city: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { city: 'Pune', lat: 18.5204, lng: 73.8567 },
  { city: 'Ahmedabad', lat: 23.0225, lng: 72.5714 },
  { city: 'Jaipur', lat: 26.9124, lng: 75.7873 },
  { city: 'Lucknow', lat: 26.8467, lng: 80.9462 },
  { city: 'Kochi', lat: 9.9312, lng: 76.2673 },
  { city: 'Chandigarh', lat: 30.7333, lng: 76.7794 },
  { city: 'Bhopal', lat: 23.2599, lng: 77.4126 },
  { city: 'Guwahati', lat: 26.1445, lng: 91.7362 },
  { city: 'Patna', lat: 25.5941, lng: 85.1376 },
];

export const CONFIG = {
  accountCount: 600,
  transactionCount: 5000,
  days: 7,
  cities: CITIES,
} as const;
