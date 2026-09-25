/**
 * PropertyData's documented example responses, one per endpoint, copied from
 * https://propertydata.co.uk/api/documentation/<endpoint> (the `data-json` of
 * each page's sample output). They are what the parsers in
 * `../propertydata-parse.ts` are tested against, and the closest thing to a
 * live call this repo can make without a key. `councilTax.properties` is
 * trimmed to twelve rows; everything else is verbatim.
 */

export const PD_FIXTURES: Record<string, unknown> = {
  "floorAreas": {
    "status": "success",
    "postcode": "W14 9JH",
    "postcode_type": "full",
    "known_floor_areas": [
      {
        "inspection_date": "2016-08-31",
        "address": "Third Floor Flat, 32 Charleville Road",
        "square_feet": 603,
        "habitable_rooms": 3
      },
      {
        "inspection_date": "2016-04-13",
        "address": "Flat B8, 32 Charleville Road",
        "square_feet": 258,
        "habitable_rooms": 1
      },
      {
        "inspection_date": "2016-03-22",
        "address": "First Floor Flat, 46 Charleville Road",
        "square_feet": 603,
        "habitable_rooms": 2
      },
      {
        "inspection_date": "2016-02-02",
        "address": "18b Charleville Road",
        "square_feet": 258,
        "habitable_rooms": 1
      },
      {
        "inspection_date": "2015-12-15",
        "address": "Flat 1, 48 Charleville Road",
        "square_feet": 215,
        "habitable_rooms": 1
      }
    ],
    "process_time": "0.03"
  },
  "valuationRent": {
    "status": "success",
    "postcode": "OX4 1YB",
    "postcode_type": "full",
    "params": {
      "property_type": "Flat",
      "construction_date": "Pre-1914",
      "internal_area": "828",
      "bedrooms": "3",
      "bathrooms": "1",
      "finish_quality": "Below average",
      "outdoor_space": "Garden",
      "off_street_parking": "0 spaces"
    },
    "result": {
      "estimate": 332,
      "unit": "gbp_per_week"
    },
    "process_time": "0.41"
  },
  "valuationSale": {
    "status": "success",
    "postcode": "OX4 1YB",
    "postcode_type": "full",
    "params": {
      "property_type": "Flat",
      "construction_date": "Pre-1914",
      "internal_area": "828",
      "bedrooms": "3",
      "bathrooms": "1",
      "finish_quality": "Below average",
      "outdoor_space": "Garden",
      "off_street_parking": "0 spaces"
    },
    "result": {
      "estimate": 390000,
      "margin": 20000,
      "confidence": "high"
    },
    "process_time": "0.40"
  },
  "stampDuty": {
    "status": "success",
    "transaction_tax_name": "LBTT",
    "transaction_tax_payable": 22100,
    "effective_rate": "8.8",
    "country_used": "scotland",
    "mode_used": "investment",
    "uk_resident": true,
    "transaction_date": "2025-02-12",
    "process_time": "0.02"
  },
  "mortgageRates": {
    "status": "success",
    "data": {
      "fixed_rate": {
        "2_year": {
          "date": "Jun 2023",
          "avg_interest_rate": "5.50%"
        },
        "3_year": {
          "date": "Jun 2023",
          "avg_interest_rate": "5.29%"
        }
      },
      "variable_rate": {
        "date": "Jun 2023",
        "avg_interest_rate": "7.54%"
      }
    },
    "process_time": "0.02"
  },
  "councilTax": {
    "status": "success",
    "postcode": "W14 9JH",
    "postcode_type": "full",
    "council": "Hammersmith and Fulham",
    "council_rating": "Low tax",
    "year": "2026/27",
    "council_tax": {
      "band_a": "1,013.01",
      "band_b": "1,181.84",
      "band_c": "1,350.68",
      "band_d": "1,519.51",
      "band_e": "1,857.18",
      "band_f": "2,194.85",
      "band_g": "2,532.52",
      "band_h": "3,039.02"
    },
    "note": "These figures are the average council tax payable annually by band for a dwelling occupied by 2 adults.",
    "properties": [
      {
        "address": "MAIS 1ST 2ND & 3RD FLRS AT 3, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "E"
      },
      {
        "address": "FLAT 1ST FLR AT 7A, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "C"
      },
      {
        "address": "FLAT BST AT 18, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "E"
      },
      {
        "address": "FLAT LHS GND FLR AT 18, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "C"
      },
      {
        "address": "FLAT RHS GND FLR AT 18, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "C"
      },
      {
        "address": "FLAT 1ST FLR AT 18, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "D"
      },
      {
        "address": "FLAT 2ND FLR AT 18, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "C"
      },
      {
        "address": "FLAT 3RD FLR AT 18, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "E"
      },
      {
        "address": "FLAT 2ND FLR AT 19, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "D"
      },
      {
        "address": "FLAT 3RD FLR AT 19, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "D"
      },
      {
        "address": "MAIS BST & GND FLR AT 20, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "E"
      },
      {
        "address": "FLAT 2 AT 20, CHARLEVILLE ROAD, LONDON, W14 9JH",
        "band": "D"
      }
    ],
    "process_time": "0.04"
  },
  "energyEfficiency": {
    "status": "success",
    "postcode": "W14 9JH",
    "postcode_type": "full",
    "energy_efficiency": [
      {
        "inspection_date": "2023-01-27T00:00:00.000000Z",
        "address": "Flat 3 , 26 , Charleville Road ",
        "score": 66,
        "rating": "D"
      },
      {
        "inspection_date": "2022-10-03T23:00:00.000000Z",
        "address": "Maisonette First Second And Third Floors, 44 Charleville Road",
        "score": 75,
        "rating": "C"
      },
      {
        "inspection_date": "2010-01-04T00:00:00.000000Z",
        "address": "Top Floor Flat, 34 Charleville Road",
        "score": 45,
        "rating": "E"
      }
    ],
    "process_time": "0.06"
  },
  "floodRisk": {
    "status": "success",
    "what3words": "pretty.needed.chill",
    "flood_risk": "High",
    "process_time": "1.02"
  },
  "conservationArea": {
    "status": "success",
    "postcode": "EX35 6EQ",
    "postcode_type": "full",
    "conservation_area": true,
    "conservation_area_name": "Lynmouth conservation area",
    "process_time": "1.13"
  },
  "greenBelt": {
    "status": "success",
    "postcode": "OX44 9LW",
    "postcode_type": "full",
    "green_belt": true,
    "green_belt_name": "Oxford Greenbelt",
    "process_time": "2.75"
  },
  "aonb": {
    "status": "success",
    "postcode": "OX7 3EX",
    "postcode_type": "full",
    "aonb": true,
    "aonb_name": "Cotswolds AONB",
    "process_time": "1.87"
  },
  "nationalPark": {
    "status": "success",
    "postcode": "EX35 6EQ",
    "postcode_type": "full",
    "national_park": true,
    "national_park_name": "Exmoor National Park",
    "process_time": "1.02"
  },
  "listedBuildings": {
    "status": "success",
    "postcode": "NW6 7YD",
    "postcode_type": "full",
    "data": {
      "listed_buildings": {
        "0": {
          "name": "MECCA BINGO",
          "grade": "II*",
          "list_date": "1980/10/10",
          "lat": "51.54135000",
          "lng": "-0.19828000",
          "url": "https://historicengland.org.uk/listing/the-list/list-entry/1078889",
          "distance": "0.49"
        },
        "2": {
          "name": "KENSAL HOUSE",
          "grade": "II*",
          "list_date": "1981/03/19",
          "lat": "51.52499000",
          "lng": "-0.21524000",
          "url": "https://historicengland.org.uk/listing/the-list/list-entry/1225244",
          "distance": "1.20"
        },
        "1": {
          "name": "TRELLICK TOWER CHELTENHAM ESTATE",
          "grade": "II*",
          "list_date": "1998/12/22",
          "lat": "51.52366000",
          "lng": "-0.20539000",
          "url": "https://historicengland.org.uk/listing/the-list/list-entry/1246688",
          "distance": "1.28"
        }
      }
    },
    "process_time": "0.54"
  },
  "demand": {
    "status": "success",
    "postcode": "W14",
    "postcode_type": "district",
    "total_for_sale": 718,
    "average_sales_per_month": 27,
    "turnover_per_month": "4%",
    "months_of_inventory": "25.0",
    "days_on_market": 761,
    "demand_rating": "Buyers market",
    "process_time": "9.78"
  },
  "demandRent": {
    "status": "success",
    "postcode": "W14",
    "postcode_type": "district",
    "total_for_rent": 656,
    "transactions_per_month": 138,
    "turnover_per_month": "21%",
    "months_of_inventory": "4.8",
    "days_on_market": 142,
    "rental_demand_rating": "Tenants market",
    "process_time": "4.32"
  },
  "keyStats": {
    "status": "success",
    "region_used": "south_east",
    "result_count": 336,
    "api_calls_cost": 30,
    "data": [
      {
        "outcode": "BN1",
        "avg_price": 395663.6,
        "avg_price_psf": 447.5,
        "avg_rent": 315.1,
        "avg_yield": "4.1%",
        "growth_1y": "3.6%",
        "growth_3y": "6.1%",
        "growth_5y": "17.8%",
        "growth_7y": "18.5%",
        "sales_per_month": 24,
        "turnover": "1%"
      },
      {
        "outcode": "BN10",
        "avg_price": 338005.5,
        "avg_price_psf": 312,
        "avg_rent": null,
        "avg_yield": null,
        "growth_1y": "1.1%",
        "growth_3y": "3.4%",
        "growth_5y": "15.4%",
        "sales_per_month": 8,
        "turnover": "4%"
      },
      {
        "outcode": "BN11",
        "avg_price": 279408,
        "avg_price_psf": 297,
        "avg_rent": 187.2,
        "avg_yield": "3.5%",
        "growth_1y": "-0.6%",
        "growth_3y": "2.6%",
        "growth_5y": "14.4%",
        "sales_per_month": 17,
        "turnover": "2%"
      }
    ],
    "process_time": "0.22"
  },
  "accountCredits": {
    "status": "success",
    "params": {
      "key": "{API_KEY}"
    },
    "result": {
      "credits_used": 36,
      "credits_remaining": 4964,
      "credits_limit": 5000,
      "credits_renew_at": "1711926000"
    },
    "process_time": "0.02"
  },
  "growth": {
    "status": "success",
    "postcode": "W14",
    "postcode_type": "district",
    "url": "https://propertydata.co.uk/draw?input=W14",
    "data": [
      [
        "Aug 2013",
        862199,
        null
      ],
      [
        "Aug 2014",
        1039052,
        "20.5%"
      ],
      [
        "Aug 2015",
        1069005,
        "2.9%"
      ],
      [
        "Aug 2016",
        1077210,
        "0.8%"
      ],
      [
        "Aug 2017",
        1123564,
        "4.3%"
      ],
      [
        "Aug 2018",
        1109593,
        "-1.2%"
      ]
    ],
    "process_time": "0.57"
  },
  "rents": {
    "status": "success",
    "postcode": "W14 9JH",
    "postcode_type": "full",
    "url": "https://propertydata.co.uk/draw?input=W14+9JH",
    "bedrooms": 2,
    "data": {
      "long_let": {
        "points_analysed": 20,
        "radius": "0.19",
        "unit": "gbp_per_week",
        "average": 438,
        "70pc_range": [
          385,
          500
        ],
        "80pc_range": [
          385,
          705
        ],
        "90pc_range": [
          381,
          735
        ],
        "100pc_range": [
          380,
          804
        ],
        "raw_data": [
          {
            "address": "Flat 2, 8 Sinclair Road, W14 0NH",
            "price": 500,
            "lat": 51.4918,
            "lng": -0.2121,
            "bedrooms": 2,
            "type": "flat",
            "distance": "0.08",
            "days_on_market": 28,
            "sstc": false,
            "portal": "Rightmove",
            "url": "https://propertydata.co.uk/outbound/rightmove/168432156"
          }
        ]
      }
    },
    "process_time": "3.66"
  }
};
