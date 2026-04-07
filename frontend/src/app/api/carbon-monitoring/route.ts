import { NextRequest, NextResponse } from 'next/server';
import ee from '@google/earthengine';
import {
  ensureInitialized,
} from '@/lib/earthEngine';

/**
 * Carbon Monitoring API
 * Fetches satellite data for carbon stock calculation
 * including AGB, BGB, and SOC for carbon credit estimation
 */

interface CarbonDataPoint {
  year: number;
  totalAreaHa: number;
  carbonPools: {
    agb: number; // Above Ground Biomass (tonnes/ha)
    bgb: number; // Below Ground Biomass (tonnes/ha)
    soc: number; // Soil Organic Carbon (tonnes/ha)
  };
  totalCarbonDensity: number; // Total carbon density (t/ha)
  totalCarbonStock: number; // Total carbon stock in tonnes
  co2Equivalent: number; // CO2 equivalent in tonnes
}

/**
 * Calculate polygon area in hectares
 */
async function calculatePolygonArea(geometry: any): Promise<number> {
  await ensureInitialized();
  const polygon = ee.Geometry.Polygon(geometry.coordinates);
  
  const areaM2 = await new Promise<number>((resolve, reject) => {
    (polygon as any).area({ maxError: 1 }).evaluate((value: number, error: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  
  return areaM2 / 10000; // Convert to hectares
}

/**
 * Fetch satellite features needed for ML model predictions
 */
async function getSatelliteFeatures(
  geometry: any,
  startDate: string,
  endDate: string
): Promise<any> {
  await ensureInitialized();
  
  const polygon = ee.Geometry.Polygon(geometry.coordinates);
  
  // Parse the year from startDate and handle current/future years
  const requestedYear = parseInt(startDate.split('-')[0]);
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1; // 1-indexed
  
  // If requesting current year, only use data up to the previous month
  // If requesting future year, fall back to last year's full data
  let effectiveStartDate = startDate;
  let effectiveEndDate = endDate;
  
  if (requestedYear > currentYear) {
    // Future year - use previous year's data
    const fallbackYear = currentYear - 1;
    effectiveStartDate = `${fallbackYear}-01-01`;
    effectiveEndDate = `${fallbackYear}-12-31`;
    console.log(`📡 AGB features: Year ${requestedYear} is in the future, using ${fallbackYear} data`);
  } else if (requestedYear === currentYear) {
    // Current year - use data up to last month to ensure availability
    const safeMonth = Math.max(1, currentMonth - 1);
    effectiveEndDate = `${currentYear}-${String(safeMonth).padStart(2, '0')}-28`;
    console.log(`📡 AGB features: Using current year data up to month ${safeMonth}`);
  }
  
  // Get Sentinel-2 data and calculate NDVI
  const s2Collection = (ee as any).ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(polygon)
    .filterDate(effectiveStartDate, effectiveEndDate)
    .filter((ee as any).Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));
  
  // Check if Sentinel-2 collection has images
  const s2Size = await new Promise<number>((resolve, reject) => {
    s2Collection.size().evaluate((value: number, error: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  
  if (s2Size === 0) {
    throw new Error(`No Sentinel-2 data available for the period ${effectiveStartDate} to ${effectiveEndDate}. Try selecting an earlier year.`);
  }
  
  console.log(`📡 Found ${s2Size} Sentinel-2 images for period ${effectiveStartDate} to ${effectiveEndDate}`);
  
  const s2Image = s2Collection.median();
  
  // Calculate NDVI
  const nir = s2Image.select('B8');
  const red = s2Image.select('B4');
  const ndvi = nir.subtract(red).divide(nir.add(red)).rename('NDVI');
  
  // Select optical bands and scale to reflectance
  const opticalBands = s2Image.select(['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B11', 'B12'])
    .divide(10000)
    .addBands(ndvi);
  
  // Get Sentinel-1 SAR data
  const s1Collection = (ee as any).ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(polygon)
    .filterDate(effectiveStartDate, effectiveEndDate)
    .filter((ee as any).Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter((ee as any).Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .filter((ee as any).Filter.eq('instrumentMode', 'IW'));
  
  // Check if Sentinel-1 collection has images
  const s1Size = await new Promise<number>((resolve, reject) => {
    s1Collection.size().evaluate((value: number, error: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  
  if (s1Size === 0) {
    throw new Error(`No Sentinel-1 data available for the period ${effectiveStartDate} to ${effectiveEndDate}. Try selecting an earlier year.`);
  }
  
  console.log(`📡 Found ${s1Size} Sentinel-1 images for period ${effectiveStartDate} to ${effectiveEndDate}`);
  
  const s1Image = s1Collection.median();
  
  // Get terrain data (elevation, slope)
  const dem = (ee as any).Image('USGS/SRTMGL1_003');
  const elevation = dem.select('elevation');
  const slope = (ee as any).Terrain.slope(elevation);
  
  // Get centroid coordinates
  const centroid = (polygon as any).centroid();
  const centroidCoords = await new Promise<any>((resolve, reject) => {
    centroid.coordinates().evaluate((value: any, error: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  
  // Combine all bands
  const allBands = opticalBands
    .addBands(s1Image.select(['VV', 'VH']))
    .addBands(elevation)
    .addBands(slope.rename('slope'));
  
  // Calculate mean values for the polygon
  const stats = allBands.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: polygon,
    scale: 10,
    maxPixels: 1e13,
  });
  
  const result = await new Promise<any>((resolve, reject) => {
    stats.evaluate((value: any, error: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  
  return {
    latitude: centroidCoords[1],
    longitude: centroidCoords[0],
    B2: result.B2 || 0,
    B3: result.B3 || 0,
    B4: result.B4 || 0,
    B5: result.B5 || 0,
    B6: result.B6 || 0,
    B7: result.B7 || 0,
    B8: result.B8 || 0,
    B11: result.B11 || 0,
    B12: result.B12 || 0,
    NDVI: result.NDVI || 0,
    VV: result.VV || 0,
    VH: result.VH || 0,
    elevation: result.elevation || 0,
    slope: result.slope || 0,
  };
}

/**
 * Fetch SOC-specific satellite features (16 features for SOC model)
 * Includes: B2, B3, B4, B8, B11, NDVI, VV, VH, Elevation, Slope, Aspect,
 *           Precip_annual, Temp_mean, Soil_texture, Latitude, Longitude
 */
async function getSOCSatelliteFeatures(
  geometry: any,
  year: number
): Promise<any> {
  await ensureInitialized();
  
  const polygon = ee.Geometry.Polygon(geometry.coordinates);
  
  // For current/future years, use the previous year's data
  const currentYear = new Date().getFullYear();
  const dataYear = year >= currentYear ? currentYear - 1 : year;
  const startDate = `${dataYear}-01-01`;
  const endDate = `${dataYear}-12-31`;
  
  console.log(`📡 SOC features: Using year ${dataYear} for data (requested ${year})`);
  
  // Get Sentinel-2 data
  const s2Collection = (ee as any).ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(polygon)
    .filterDate(startDate, endDate)
    .filter((ee as any).Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));
  
  // Check if collection has images
  const s2Size = await new Promise<number>((resolve, reject) => {
    s2Collection.size().evaluate((value: number, error: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  
  if (s2Size === 0) {
    throw new Error(`No Sentinel-2 data available for year ${dataYear}. Try selecting a different year.`);
  }
  
  const s2Image = s2Collection.median();
  
  // Calculate NDVI
  const nir = s2Image.select('B8');
  const red = s2Image.select('B4');
  const ndvi = nir.subtract(red).divide(nir.add(red)).rename('NDVI');
  
  // Select required optical bands (B2, B3, B4, B8, B11) and scale
  const opticalBands = s2Image.select(['B2', 'B3', 'B4', 'B8', 'B11'])
    .divide(10000)
    .addBands(ndvi);
  
  // Get Sentinel-1 SAR data (VV, VH)
  const s1Collection = (ee as any).ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(polygon)
    .filterDate(startDate, endDate)
    .filter((ee as any).Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter((ee as any).Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .filter((ee as any).Filter.eq('instrumentMode', 'IW'));
  
  // Check if collection has images  
  const s1Size = await new Promise<number>((resolve, reject) => {
    s1Collection.size().evaluate((value: number, error: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  
  if (s1Size === 0) {
    throw new Error(`No Sentinel-1 data available for year ${dataYear}. Try selecting a different year.`);
  }
  
  const s1Image = s1Collection.median();
  
  // Get terrain data (elevation, slope, aspect)
  const dem = (ee as any).Image('USGS/SRTMGL1_003');
  const elevation = dem.select('elevation');
  const slope = (ee as any).Terrain.slope(elevation);
  const aspect = (ee as any).Terrain.aspect(elevation);
  
  // Get annual precipitation from CHIRPS
  const chirps = (ee as any).ImageCollection('UCSB-CHG/CHIRPS/DAILY')
    .filterBounds(polygon)
    .filterDate(startDate, endDate)
    .sum()  // Sum daily precipitation for annual total
    .rename('precip_annual');
  
  // Get mean temperature from ERA5-Land (convert from Kelvin to Celsius)
  const era5 = (ee as any).ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
    .filterBounds(polygon)
    .filterDate(startDate, endDate)
    .select('temperature_2m')
    .mean()
    .subtract(273.15)  // Convert K to C
    .rename('temp_mean');
  
  // Get soil texture from OpenLandMap
  const soilTexture = (ee as any).Image('OpenLandMap/SOL/SOL_TEXTURE-CLASS_USDA-TT_M/v02')
    .select('b0')  // Top layer texture class
    .rename('soil_texture');
  
  // Get bulk density from OpenLandMap (for SOC calculation)
  const bulkDensity = (ee as any).Image('OpenLandMap/SOL/SOL_BULKDENS-FINEEARTH_USDA-4A1H_M/v02')
    .select('b0')  // Top layer bulk density (cg/cm³)
    .divide(100)  // Convert to g/cm³
    .rename('bulk_density');
  
  // Get centroid coordinates
  const centroid = (polygon as any).centroid();
  const centroidCoords = await new Promise<any>((resolve, reject) => {
    centroid.coordinates().evaluate((value: any, error: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  
  // Combine all bands
  const allBands = opticalBands
    .addBands(s1Image.select(['VV', 'VH']))
    .addBands(elevation)
    .addBands(slope.rename('slope'))
    .addBands(aspect.rename('aspect'))
    .addBands(chirps)
    .addBands(era5)
    .addBands(soilTexture)
    .addBands(bulkDensity);
  
  // Calculate mean values for the polygon
  const stats = allBands.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: polygon,
    scale: 30,  // Use 30m resolution for mixed data sources
    maxPixels: 1e13,
  });
  
  const result = await new Promise<any>((resolve, reject) => {
    stats.evaluate((value: any, error: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  
  console.log('SOC features extracted:', result);
  
  // Return 16 features expected by SOC model (matching TABLE II)
  return {
    B2: result.B2 || 0,
    B3: result.B3 || 0,
    B4: result.B4 || 0,
    B8: result.B8 || 0,
    B11: result.B11 || 0,
    NDVI: result.NDVI || 0,
    VV: result.VV || 0,
    VH: result.VH || 0,
    elevation: result.elevation || 0,
    slope: result.slope || 0,
    aspect: result.aspect || 0,
    precip_annual: result.precip_annual || 0,
    temp_mean: result.temp_mean || 0,
    soil_texture: result.soil_texture || 0,
    latitude: centroidCoords[1],
    longitude: centroidCoords[0],
    bulk_density: result.bulk_density || 1.3,  // Default bulk density if not available
  };
}

/**
 * Get biomass data using local ML model
 */
async function getBiomassData(
  geometry: any,
  year: number
): Promise<{
  agb: number;
  bgb: number;
}> {
  try {
    const MODEL_SERVER_URL = process.env.MODEL_SERVER_URL || 'http://localhost:5000';
    
    // Use full year range for satellite data (Jan 1 to Dec 31)
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;
    
    console.log(`🛰️ Fetching satellite features for year ${year} (${startStr} to ${endStr})`);
    
    // Fetch satellite features
    const features = await getSatelliteFeatures(geometry, startStr, endStr);
    
    console.log(`🤖 Calling local model server for AGB prediction...`);
    
    // Call local model server
    const response = await fetch(`${MODEL_SERVER_URL}/predict/agb`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ features }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Model server error: ${error}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Model prediction failed');
    }
    
    return {
      agb: parseFloat(result.agb.toFixed(2)),
      bgb: parseFloat(result.bgb.toFixed(2)),
    };
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('Model server is not running. Please start it with: python python/model_server.py');
      throw new Error('Model server is not running. Please start it with: python python/model_server.py');
    }
    console.error('Error fetching biomass data:', error);
    throw new Error(`Failed to fetch biomass data: ${error.message}`);
  }
}

/**
 * Get Soil Organic Carbon (SOC) data using local ML model
 */
async function getSOCData(geometry: any, year: number): Promise<number> {
  try {
    const MODEL_SERVER_URL = process.env.MODEL_SERVER_URL || 'http://localhost:5000';
    
    console.log(`🛰️ Fetching SOC-specific satellite features for year ${year}...`);
    
    // Fetch SOC-specific satellite features (16 features)
    const features = await getSOCSatelliteFeatures(geometry, year);
    
    console.log(`Calling local model server for SOC prediction...`);
    
    // Call local model server
    const response = await fetch(`${MODEL_SERVER_URL}/predict/soc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ features }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Model server error: ${error}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Model prediction failed');
    }
    
    return parseFloat(result.soc.toFixed(2));
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('Model server is not running. Please start it with: python python/model_server.py');
      throw new Error('Model server is not running. Please start it with: python python/model_server.py');
    }
    console.error('Error fetching SOC data:', error);
    throw new Error(`Failed to fetch SOC data: ${error.message}`);
  }
}

/**
 * Get carbon monitoring data for a specific year
 */
async function getCarbonDataForYear(
  geometry: any,
  year: number,
  totalAreaHa: number
): Promise<CarbonDataPoint> {
  try {
    console.log(`Fetching carbon data for year: ${year}`);
    console.log(`Total area: ${totalAreaHa.toFixed(2)} ha`);
    
    // Get biomass data (AGB and BGB) using full year
    console.log(`Fetching biomass data...`);
    const biomassData = await getBiomassData(geometry, year);
    console.log(`Biomass data: AGB=${biomassData.agb} t/ha, BGB=${biomassData.bgb} t/ha`);
    
    // Get SOC data using full year
    console.log(`Fetching SOC data...`);
    const soc = await getSOCData(geometry, year);
    console.log(`SOC data: ${soc} t/ha`);
    
    // Calculate total carbon density (t/ha) = AGB + BGB + SOC
    const carbonDensity = biomassData.agb + biomassData.bgb + soc;
    
    // Calculate total carbon stock for the entire area (tonnes)
    const totalCarbonStock = carbonDensity * totalAreaHa;
    
    // Calculate CO2 equivalent (multiply by 3.67)
    const co2Equivalent = totalCarbonStock * 3.67;
    
    console.log(`Year ${year}: Carbon density=${carbonDensity.toFixed(2)} t/ha, Total=${totalCarbonStock.toFixed(2)} tonnes, CO2eq=${co2Equivalent.toFixed(2)} tonnes`);
    
    return {
      year,
      totalAreaHa: parseFloat(totalAreaHa.toFixed(2)),
      carbonPools: {
        agb: parseFloat(biomassData.agb.toFixed(2)),
        bgb: parseFloat(biomassData.bgb.toFixed(2)),
        soc: parseFloat(soc.toFixed(2)),
      },
      totalCarbonDensity: parseFloat(carbonDensity.toFixed(2)),
      totalCarbonStock: parseFloat(totalCarbonStock.toFixed(2)),
      co2Equivalent: parseFloat(co2Equivalent.toFixed(2)),
    };
  } catch (error: any) {
    console.error(`Error fetching carbon data for year ${year}:`, error);
    throw new Error(`Failed to fetch carbon data for year ${year}: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { geometry, startYear, endYear } = body;

    if (!geometry || !startYear || !endYear) {
      return NextResponse.json(
        { error: 'Missing required parameters: geometry, startYear, endYear' },
        { status: 400 }
      );
    }

    console.log(`Fetching carbon monitoring data for years ${startYear} to ${endYear}`);

    // Calculate polygon area once for consistency
    const totalAreaHa = await calculatePolygonArea(geometry);
    console.log(`Polygon area: ${totalAreaHa.toFixed(2)} ha`);

    // Fetch data for both years in parallel
    const [startData, endData] = await Promise.all([
      getCarbonDataForYear(geometry, startYear, totalAreaHa),
      getCarbonDataForYear(geometry, endYear, totalAreaHa),
    ]);

    // Calculate time period
    const yearsDifference = endYear - startYear;
    const daysDifference = yearsDifference * 365;

    // Calculate carbon stock change
    const carbonStockChange = endData.totalCarbonStock - startData.totalCarbonStock;
    const carbonStockChangePercent = startData.totalCarbonStock > 0 
      ? (carbonStockChange / startData.totalCarbonStock) * 100 
      : 0;
    const annualCarbonChange = yearsDifference > 0 
      ? carbonStockChange / yearsDifference 
      : 0;

    return NextResponse.json({
      success: true,
      data: {
        // Carbon stock for start year
        startYear: startData,
        // Carbon stock for end year
        endYear: endData,
        // Carbon stock change analysis
        carbonChange: {
          // Per hectare changes
          agbChange: parseFloat((endData.carbonPools.agb - startData.carbonPools.agb).toFixed(2)),
          bgbChange: parseFloat((endData.carbonPools.bgb - startData.carbonPools.bgb).toFixed(2)),
          socChange: parseFloat((endData.carbonPools.soc - startData.carbonPools.soc).toFixed(2)),
          densityChange: parseFloat((endData.totalCarbonDensity - startData.totalCarbonDensity).toFixed(2)),
          // Total area changes
          totalChange: parseFloat(carbonStockChange.toFixed(2)),
          percentChange: parseFloat(carbonStockChangePercent.toFixed(2)),
          annualChange: parseFloat(annualCarbonChange.toFixed(2)),
          co2EquivalentChange: parseFloat((carbonStockChange * 3.67).toFixed(2)),
          // Status
          status: carbonStockChange > 0 ? 'Carbon Gain' : carbonStockChange < 0 ? 'Carbon Loss' : 'No Change',
        },
        // Analysis period
        period: {
          startYear,
          endYear,
          durationYears: yearsDifference,
        },
        // Area information
        area: {
          hectares: totalAreaHa,
          squareMeters: totalAreaHa * 10000,
        },
        // Metadata
        metadata: {
          analysisDate: new Date().toISOString(),
          coordinateSystem: 'EPSG:4326',
          formulas: {
            bgb: 'BGB = AGB × 0.2 (root-to-shoot ratio)',
            soc: 'SOC_stock = H × BD × OC × 0.01 (H=30cm depth, BD=bulk density, OC=organic carbon)',
            total: 'Total Carbon = AGB + BGB + SOC',
            co2: 'CO₂ equivalent = Carbon × 3.67',
          },
          models: {
            agb: 'XGBRegressor trained on NE India data (19 features)',
            soc: 'RandomForestRegressor trained on NE India data (16 features)',
          },
        },
      },
    });
  } catch (error: any) {
    console.error('Error in carbon monitoring:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to fetch carbon monitoring data',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}
