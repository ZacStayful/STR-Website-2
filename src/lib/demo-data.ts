import type { AnalysisResult } from "./types";

// Manchester demo — 803 Eastbank Tower, M4 7FE
export const DEMO_MANCHESTER: AnalysisResult = {
  property: {
    address: "803 Eastbank Tower",
    postcode: "M4 7FE",
    bedrooms: 2,
    guests: 4,
  },
  coordinates: { lat: 53.4849, lng: -2.2346 },
  shortLet: {
    annualRevenue: 41364,
    monthlyRevenue: [2615, 2289, 3046, 3585, 3217, 4870, 3896, 3536, 4328, 3797, 3920, 2265],
    occupancyRate: 0.61,
    averageDailyRate: 177,
    activeListings: 501,
    comparables: [
      { title: "City Centre Penthouse", url: "#", bedrooms: 2, accommodates: 4, averageDailyRate: 165, occupancyRate: 0.65, annualRevenue: 39131, distance: 0.3, rating: 4.8, reviewCount: 92, listingAge: 3.2, daysAvailable: 310, amenityCount: 18 },
      { title: "Northern Quarter Loft", url: "#", bedrooms: 2, accommodates: 4, averageDailyRate: 155, occupancyRate: 0.63, annualRevenue: 35640, distance: 0.5, rating: 4.6, reviewCount: 67, listingAge: 2.1, daysAvailable: 295, amenityCount: 14 },
      { title: "Ancoats Modern Flat", url: "#", bedrooms: 2, accommodates: 3, averageDailyRate: 142, occupancyRate: 0.68, annualRevenue: 35243, distance: 0.4, rating: 4.9, reviewCount: 104, listingAge: 4.0, daysAvailable: 340, amenityCount: 15 },
      { title: "Deansgate Luxury Suite", url: "#", bedrooms: 2, accommodates: 4, averageDailyRate: 195, occupancyRate: 0.58, annualRevenue: 41292, distance: 0.7, rating: 4.5, reviewCount: 45, listingAge: 1.5, daysAvailable: 280, amenityCount: 15 },
      { title: "Piccadilly Village Apt", url: "#", bedrooms: 2, accommodates: 4, averageDailyRate: 170, occupancyRate: 0.62, annualRevenue: 38470, distance: 0.2, rating: 4.7, reviewCount: 78, listingAge: 2.8, daysAvailable: 320, amenityCount: 15 },
      { title: "Spinningfields Studio", url: "#", bedrooms: 1, accommodates: 2, averageDailyRate: 125, occupancyRate: 0.70, annualRevenue: 31937, distance: 0.8, rating: 4.4, reviewCount: 53, listingAge: 1.8, daysAvailable: 350, amenityCount: 15 },
      { title: "MediaCity Waterfront", url: "#", bedrooms: 2, accommodates: 4, averageDailyRate: 180, occupancyRate: 0.57, annualRevenue: 37454, distance: 1.2, rating: 4.3, reviewCount: 31, listingAge: 0.9, daysAvailable: 260, amenityCount: 15 },
      { title: "Victoria Warehouse Flat", url: "#", bedrooms: 2, accommodates: 4, averageDailyRate: 160, occupancyRate: 0.64, annualRevenue: 37376, distance: 0.6, rating: 4.6, reviewCount: 85, listingAge: 3.5, daysAvailable: 305, amenityCount: 15 },
    ],
  },
  longLet: {
    monthlyRent: 1153,
    estimateHigh: 1326,
    estimateLow: 980,
    comparables: [
      { address: "Great Ancoats Street, M4", rent: 1200, distance: 0.3, bedrooms: 2 },
      { address: "Jersey Street, M4", rent: 1100, distance: 0.4, bedrooms: 2 },
      { address: "Bengal Street, M4", rent: 1175, distance: 0.5, bedrooms: 2 },
      { address: "Pollard Street, M4", rent: 1150, distance: 0.6, bedrooms: 2 },
    ],
  },
  demandDrivers: {
    hospitals: [
      { name: "Manchester Royal Infirmary", type: "hospital", address: "Oxford Road, M13 9WL", distance: 1.9, rating: 4.0 },
      { name: "Royal Manchester Children's Hospital", type: "hospital", address: "Oxford Road, M13 9WL", distance: 2.0, rating: 4.2 },
    ],
    universities: [
      { name: "The University of Manchester", type: "university", address: "Oxford Road, M13 9PL", distance: 1.7, rating: 4.5 },
      { name: "Manchester Metropolitan University", type: "university", address: "All Saints, M15 6BH", distance: 2.1, rating: 4.3 },
      { name: "University of Salford", type: "university", address: "Salford, M5 4WT", distance: 2.0, rating: 4.1 },
    ],
    airports: [
      { name: "Manchester Airport", type: "airport", address: "M90 1QX", distance: 14.5, rating: 3.8 },
    ],
    trainStations: [
      { name: "Manchester Piccadilly", type: "train_station", address: "London Road, M1 2PB", distance: 0.7, rating: 4.3 },
      { name: "Manchester Victoria", type: "train_station", address: "Victoria Station, M3 1WY", distance: 0.5, rating: 4.0 },
    ],
    busStations: [
      { name: "Piccadilly Gardens Bus Station", type: "bus_station", address: "Piccadilly, M1 1RG", distance: 0.9, rating: 3.5 },
    ],
    subwayStations: [],
  },
  nearbyEvents: {
    events: [
      { name: "Manchester United vs Liverpool", date: "2026-04-12", time: "16:30", venue: "Old Trafford", category: "Sports", genre: "Football", distance: 3.5, url: "#" },
      { name: "The Warehouse Project", date: "2026-04-18", time: "21:00", venue: "Depot Mayfield", category: "Music", genre: "Electronic", distance: 0.8, url: "#" },
      { name: "Manchester International Festival", date: "2026-07-01", time: "12:00", venue: "Various Venues", category: "Arts", genre: "Mixed", distance: 1.0, url: "#" },
      { name: "Parklife Festival", date: "2026-06-13", time: "12:00", venue: "Heaton Park", category: "Music", genre: "Festival", distance: 5.0, url: "#" },
      { name: "Manchester Comedy Festival", date: "2026-10-15", time: "19:30", venue: "Albert Hall", category: "Comedy", genre: "Stand-up", distance: 1.2, url: "#" },
    ],
    totalEvents: 1183,
  },
  financials: {
    shortLetGrossAnnual: 41364,
    shortLetNetAnnual: 21509, // 41364 * 0.52
    longLetGrossAnnual: 13836,
    longLetNetAnnual: 12452, // 13836 * 0.90
    monthlyDifference: 755,
    annualDifference: 9057,
    breakEvenOccupancy: 0.34,
  },
  risk: {
    incomeVolatility: "low",
    setupCost: "moderate",
    regulatory: "moderate",
    guestDamage: "moderate",
    seasonality: "low",
    platformDependency: "moderate",
    locationDemand: "low",
    competition: "high",
    overallScore: 38,
  },
  verdict: {
    fit: "strong",
    netDifference: 9056,
    riskLevel: "low",
    ownerInvolvement: "low",
    recommendation: "This property is a strong candidate for short-term letting. It could generate approximately £9,056 more per year (£755/month) compared to a traditional long-let. The break-even occupancy is 34%, which is comfortably achievable given Manchester's strong demand drivers. Risk profile is low, making this a favourable opportunity with manageable downside.",
  },
  dataQuality: {
    comparablesFound: 12,
    comparablesTarget: 12,
    searchRadiusKm: 1.5,
    searchBroadened: false,
    level: "high" as const,
    disclaimer: null,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Newcastle demo — 5 Camborne Park, NE8 4EG
export const DEMO_RESULT: AnalysisResult = {
  property: {
    address: "5 Camborne Park, Durham Road",
    postcode: "NE8 4EG",
    bedrooms: 2,
    guests: 4,
  },
  coordinates: { lat: 54.9527, lng: -1.6204 },
  shortLet: {
    annualRevenue: 19167,
    monthlyRevenue: [558, 601, 730, 816, 945, 988, 1074, 1160, 945, 773, 644, 730],
    occupancyRate: 0.58,
    averageDailyRate: 94,
    activeListings: 142,
    comparables: [
      { title: "Central Location Gem", url: "https://www.airbnb.co.uk/rooms/1", bedrooms: 2, accommodates: 4, averageDailyRate: 89, occupancyRate: 0.62, annualRevenue: 20146, distance: 0.3, rating: 4.7, reviewCount: 58, listingAge: 2.5, daysAvailable: 300, amenityCount: 15 },
      { title: "Executive Accommodation", url: "https://www.airbnb.co.uk/rooms/2", bedrooms: 2, accommodates: 4, averageDailyRate: 105, occupancyRate: 0.55, annualRevenue: 21079, distance: 0.5, rating: 4.5, reviewCount: 42, listingAge: 1.8, daysAvailable: 275, amenityCount: 15 },
      { title: "Spacious Family Home", url: "https://www.airbnb.co.uk/rooms/3", bedrooms: 2, accommodates: 5, averageDailyRate: 98, occupancyRate: 0.60, annualRevenue: 21462, distance: 0.7, rating: 4.8, reviewCount: 73, listingAge: 3.1, daysAvailable: 320, amenityCount: 15 },
      { title: "Boutique Guest Suite", url: "https://www.airbnb.co.uk/rooms/4", bedrooms: 2, accommodates: 3, averageDailyRate: 82, occupancyRate: 0.64, annualRevenue: 19149, distance: 0.4, rating: 4.6, reviewCount: 36, listingAge: 1.2, daysAvailable: 290, amenityCount: 15 },
      { title: "Cosy City Apartment", url: "https://www.airbnb.co.uk/rooms/5", bedrooms: 2, accommodates: 4, averageDailyRate: 78, occupancyRate: 0.61, annualRevenue: 17366, distance: 0.6, rating: 4.4, reviewCount: 29, listingAge: 2.0, daysAvailable: 310, amenityCount: 18 },
      { title: "Charming Victorian Flat", url: "https://www.airbnb.co.uk/rooms/6", bedrooms: 2, accommodates: 4, averageDailyRate: 91, occupancyRate: 0.56, annualRevenue: 18594, distance: 0.8, rating: 4.3, reviewCount: 51, listingAge: 3.8, daysAvailable: 265, amenityCount: 15 },
      { title: "Stylish Studio Space", url: "https://www.airbnb.co.uk/rooms/7", bedrooms: 1, accommodates: 2, averageDailyRate: 72, occupancyRate: 0.67, annualRevenue: 17605, distance: 0.2, rating: 4.9, reviewCount: 88, listingAge: 4.2, daysAvailable: 345, amenityCount: 15 },
      { title: "Modern Urban Retreat", url: "https://www.airbnb.co.uk/rooms/8", bedrooms: 2, accommodates: 4, averageDailyRate: 101, occupancyRate: 0.53, annualRevenue: 19533, distance: 1.0, rating: 4.2, reviewCount: 22, listingAge: 0.7, daysAvailable: 250, amenityCount: 15 },
    ],
  },
  longLet: {
    monthlyRent: 1190,
    estimateHigh: 1350,
    estimateLow: 1050,
    comparables: [
      { address: "Durham Road, Gateshead", rent: 1200, distance: 0.2, bedrooms: 2 },
      { address: "Bensham Road, Gateshead", rent: 1150, distance: 0.5, bedrooms: 2 },
      { address: "Saltwell Road, Gateshead", rent: 1250, distance: 0.8, bedrooms: 2 },
      { address: "Whitehall Road, Gateshead", rent: 1100, distance: 0.6, bedrooms: 2 },
      { address: "Coatsworth Road, Gateshead", rent: 1225, distance: 0.4, bedrooms: 2 },
    ],
  },
  demandDrivers: {
    hospitals: [
      { name: "Queen Elizabeth Hospital", type: "hospital", address: "Sheriff Hill, Gateshead NE9 6SX", distance: 2.1, rating: 4.1 },
    ],
    universities: [
      { name: "Newcastle University", type: "university", address: "Newcastle upon Tyne NE1 7RU", distance: 1.8, rating: 4.5 },
      { name: "Northumbria University", type: "university", address: "Newcastle upon Tyne NE1 8ST", distance: 2.0, rating: 4.3 },
    ],
    airports: [
      { name: "Newcastle International Airport", type: "airport", address: "Woolsington NE13 8BZ", distance: 9.5, rating: 4.0 },
    ],
    trainStations: [
      { name: "Newcastle Central Station", type: "train_station", address: "Neville Street, Newcastle NE1 5DL", distance: 1.5, rating: 4.2 },
      { name: "MetroCentre Station", type: "train_station", address: "Gateshead NE11 9YG", distance: 3.2, rating: 3.8 },
    ],
    busStations: [
      { name: "Gateshead Interchange", type: "bus_station", address: "Gateshead NE8 1BH", distance: 0.8, rating: 3.5 },
    ],
    subwayStations: [
      { name: "Gateshead Metro Station", type: "subway_station", address: "Gateshead NE8 1AE", distance: 0.7, rating: 3.9 },
    ],
  },
  nearbyEvents: {
    events: [
      { name: "The Great Exhibition of the North", date: "2026-04-15", time: "10:00", venue: "BALTIC Centre", category: "Exhibition", genre: "Art", distance: 1.2, url: "#" },
      { name: "Newcastle United vs Sunderland", date: "2026-04-20", time: "15:00", venue: "St James' Park", category: "Sports", genre: "Football", distance: 2.0, url: "#" },
      { name: "Sage Gateshead Concert Series", date: "2026-05-01", time: "19:30", venue: "Sage Gateshead", category: "Music", genre: "Classical", distance: 1.0, url: "#" },
      { name: "Gateshead Food & Drink Festival", date: "2026-05-10", time: "11:00", venue: "Gateshead Quays", category: "Festival", genre: "Food", distance: 1.1, url: "#" },
      { name: "Great North Run", date: "2026-09-13", time: "10:00", venue: "Newcastle to South Shields", category: "Sports", genre: "Running", distance: 0.5, url: "#" },
    ],
    totalEvents: 23,
  },
  financials: {
    shortLetGrossAnnual: 19167,
    shortLetNetAnnual: 9967, // 19167 * 0.52
    longLetGrossAnnual: 14280,
    longLetNetAnnual: 12852, // 14280 * 0.90
    monthlyDifference: -240,
    annualDifference: -2885,
    breakEvenOccupancy: 0.72,
  },
  risk: {
    incomeVolatility: "moderate",
    setupCost: "moderate",
    regulatory: "low",
    guestDamage: "moderate",
    seasonality: "moderate",
    platformDependency: "high",
    locationDemand: "low",
    competition: "moderate",
    overallScore: 48,
  },
  verdict: {
    fit: "moderate",
    netDifference: -2885,
    riskLevel: "moderate",
    ownerInvolvement: "moderate",
    recommendation:
      "This property shows moderate potential for short-term letting. While the gross revenue is attractive, after accounting for operating costs (cleaning, supplies, platform fees, utilities), the net income is lower than a traditional long-term let. Consider this route if you value flexibility and are willing to actively manage the property or hire a management company.",
  },
  dataQuality: {
    comparablesFound: 8,
    comparablesTarget: 12,
    searchRadiusKm: 3,
    searchBroadened: true,
    level: "moderate" as const,
    disclaimer: "Only 8 comparable 2-bedroom properties were found within 3km. Data accuracy may be slightly reduced. This could indicate a unique property type for the area — uniqueness is often advantageous for short-term letting.",
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Map of demo properties by key
export const DEMO_MAP: Record<string, AnalysisResult> = {
  manchester: DEMO_MANCHESTER,
  newcastle: DEMO_RESULT,
  true: DEMO_RESULT, // default for ?demo=true
};
