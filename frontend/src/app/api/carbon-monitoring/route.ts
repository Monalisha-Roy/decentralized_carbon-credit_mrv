
import { NextRequest, NextResponse } from 'next/server';
import ee from '@google/earthengine';
import { PublicKey } from '@solana/web3.js';
import {
  ensureInitialized,
} from '@/lib/earthEngine';

export const maxDuration = 300;
/**
 * Carbon Monitoring API
 * Fetches satellite data for carbon stock calculation
 * including AGB, BGB, and SOC for carbon credit estimation
 * 
 * NOTE: Coordinates are fetched from the land record stored on Solana blockchain
 * The land must be verified by the platform authority to calculate credits
 */

interface CarbonDataPoint {
  year: number;
  totalAreaHa: number;
  carbonPools: {
    agb: number;
    bgb: number;
    soc: number;
  };
  totalCarbonDensity: number;
  totalCarbonStock: number;
  co2Equivalent: number;
  agbSource?: 'drone' | 'satellite';
}

/**
 * Land record structure matching Solana contract
 */
interface LandRecord {
  owner: string;
  landId: string;
  polygonCoordinates: Array<[number, number]>;
  documentCid: string;
  areaHectares: number;
  isVerified: boolean;
  isDeclined: boolean;
}

/**
 * Geometry structure from IPFS
 */
interface GeometryData {
  type: string;
  coordinates: number[][][]; // For polygons: [[[lon, lat], [lon, lat], ...]]
}

/**
 * Fetch land record from Solana blockchain via Anchor IDL
 */
async function getLandRecordFromBlockchain(
  landId: string,
  programId: string
): Promise<LandRecord> {
  try {
    // This would typically use the Anchor program instance to fetch the PDA
    // For now, we'll return a placeholder that should be called from the client
    // In production, this should be fetched server-side from an RPC endpoint

    // The landId is deterministic: first 16 chars of IPFS CID
    // PDA seed: [Buffer.from("land"), Buffer.from(landId)]

    throw new Error(
      'Land records must be fetched from the frontend and passed to this API. ' +
      'Pass: { landId: string, landRecordData: LandRecord, startYear, endYear }'
    );
  } catch (error: any) {
    throw new Error(`Failed to fetch land record: ${error.message}`);
  }
}

/**
 * Fetch geometry coordinates from IPFS via Pinata
 */
async function getGeometryFromIPFS(ipfsCid: string): Promise<GeometryData> {
  try {
    // Construct Pinata gateway URL
    const pinataGateway = 'https://gateway.pinata.cloud/ipfs';
    const ipfsUrl = `${pinataGateway}/${ipfsCid}`;

    console.log(`📥 Fetching geometry from IPFS: ${ipfsUrl}`);

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(ipfsUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`IPFS fetch failed with status ${response.status}`);
    }

    // Get content-type to validate response
    const contentType = response.headers.get('content-type');
    const text = await response.text();

    // Validate response is not empty
    if (!text || text.length === 0) {
      throw new Error('IPFS returned empty response');
    }

    // Try to parse as JSON
    let data: any;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error('Failed to parse IPFS response as JSON:', parseError);
      console.error('Response preview:', text.substring(0, 100));
      throw new Error(`IPFS data is not valid JSON. Content-Type: ${contentType}. Make sure the IPFS CID points to a GeoJSON file.`);
    }

    // Validate geometry structure
    if (!data.type || !data.coordinates) {
      throw new Error('Invalid geometry data from IPFS: missing type or coordinates field. Expected GeoJSON format.');
    }

    // Validate coordinates array
    if (!Array.isArray(data.coordinates) || data.coordinates.length === 0) {
      throw new Error('Invalid coordinates in geometry: empty or not an array');
    }

    console.log(`✅ Geometry fetched from IPFS: ${data.type} with ${data.coordinates[0]?.length || 0} vertices`);

    return data as GeometryData;
  } catch (error: any) {
    console.error('Error fetching geometry from IPFS:', error);
    throw new Error(`Failed to fetch geometry from IPFS: ${error.message}`);
  }
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
 * Helper function to evaluate Earth Engine objects with timeout
 */
async function evaluateWithTimeout<T>(
  promise: Promise<any>,
  timeoutMs: number = 60000,
  operation: string = 'Earth Engine operation'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Fetch satellite features needed for ML model predictions
 */
async function getSatelliteFeatures(
  geometry: any,
  startDate: string,
  endDate: string
): Promise<any> {
  try {
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

    // Check if Sentinel-2 collection has images with timeout
    console.log('🔄 Checking Sentinel-2 availability...');
    const s2Size = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sentinel-2 size check timed out')), 90000);
      s2Collection.size().evaluate((value: number, error: any) => {
        clearTimeout(timeout);
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

    // Check if Sentinel-1 collection has images with timeout
    console.log('🔄 Checking Sentinel-1 availability...');
    const s1Size = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sentinel-1 size check timed out')), 90000);
      s1Collection.size().evaluate((value: number, error: any) => {
        clearTimeout(timeout);
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

    // Get centroid coordinates with timeout
    console.log('🔄 Fetching centroid coordinates...');
    const centroid = (polygon as any).centroid();
    const centroidCoords = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Centroid coordinate fetch timed out')), 90000);
      centroid.coordinates().evaluate((value: any, error: any) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(value);
      });
    });

    // Combine all bands
    const allBands = opticalBands
      .addBands(s1Image.select(['VV', 'VH']))
      .addBands(elevation)
      .addBands(slope.rename('slope'));

    // Calculate mean values for the polygon with timeout
    console.log('🔄 Computing statistics for satellite bands...');
    const stats = allBands.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: polygon,
      scale: 10,
      maxPixels: 1e13,
    });

    const result = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Statistics computation timed out')), 120000);
      stats.evaluate((value: any, error: any) => {
        clearTimeout(timeout);
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
  } catch (error: any) {
    console.error('Error in getSatelliteFeatures:', error);
    const errorMsg = error?.message || String(error) || 'Unknown error';
    if (errorMsg.includes('socket hang up') || errorMsg.includes('timed out')) {
      throw new Error(`Earth Engine connection issue: ${errorMsg}. This may be a temporary network issue. Please try again.`);
    }
    throw new Error(errorMsg);
  }
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
  try {
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

    // Check if collection has images with timeout
    console.log('🔄 Checking Sentinel-2 availability for SOC...');
    const s2Size = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sentinel-2 size check timed out')), 90000);
      s2Collection.size().evaluate((value: number, error: any) => {
        clearTimeout(timeout);
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

    // Check if collection has images with timeout
    console.log('🔄 Checking Sentinel-1 availability for SOC...');
    const s1Size = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sentinel-1 size check timed out')), 90000);
      s1Collection.size().evaluate((value: number, error: any) => {
        clearTimeout(timeout);
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

    // Get centroid coordinates with timeout
    console.log('🔄 Fetching centroid coordinates for SOC...');
    const centroid = (polygon as any).centroid();
    const centroidCoords = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Centroid coordinate fetch timed out')), 90000);
      centroid.coordinates().evaluate((value: any, error: any) => {
        clearTimeout(timeout);
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

    // Calculate mean values for the polygon with timeout
    console.log('🔄 Computing statistics for SOC satellite bands...');
    const stats = allBands.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: polygon,
      scale: 30,  // Use 30m resolution for mixed data sources
      maxPixels: 1e13,
    });

    const result = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Statistics computation timed out')), 180000);
      stats.evaluate((value: any, error: any) => {
        clearTimeout(timeout);
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
  } catch (error: any) {
    console.error('Error in getSOCSatelliteFeatures:', error);
    const errorMsg = error?.message || String(error) || 'Unknown error';
    if (errorMsg.includes('socket hang up') || errorMsg.includes('timed out')) {
      throw new Error(`Earth Engine connection issue: ${errorMsg}. This may be a temporary network issue. Please try again.`);
    }
    throw new Error(errorMsg);
  }
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
    const errorMsg = error?.message || String(error) || 'Unknown error';
    throw new Error(`Failed to fetch biomass data: ${errorMsg}`);
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
    const errorMsg = error?.message || String(error) || 'Unknown error';
    throw new Error(`Failed to fetch SOC data: ${errorMsg}`);
  }
}

async function getDroneAGBData(
  orthomosaicCid: string,
  chmCid: string
): Promise<{ agb: number; bgb: number; agb_uncertainty: number }> {
  const MODEL_SERVER_URL = process.env.MODEL_SERVER_URL || 'http://localhost:5000';

  console.log('🚁 Calling drone pipeline on model server...');

  const response = await fetch(`${MODEL_SERVER_URL}/predict/drone_agb`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orthomosaic_cid: orthomosaicCid, chm_cid: chmCid }),
    signal: AbortSignal.timeout(600000), // 10 minutes for large GeoTIFF files
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Drone model server error: ${error}`);
  }

  const result = await response.json();
  if (!result.success) throw new Error(result.error || 'Drone prediction failed');

  console.log(`🚁 Drone AGB=${result.agb} t BGB=${result.bgb} t uncertainty=${result.agb_uncertainty} t`);

  return {
    agb: parseFloat(result.agb.toFixed(2)),
    bgb: parseFloat(result.bgb.toFixed(2)),
    agb_uncertainty: parseFloat(result.agb_uncertainty.toFixed(2)),
  };
}

/**
 * Get carbon monitoring data for a specific year
 */
async function getCarbonDataForYear(
  geometry: any,
  year: number,
  totalAreaHa: number,
  droneData?: { orthomosaicCid: string; chmCid: string }
): Promise<CarbonDataPoint> {
  try {
    console.log(`Fetching carbon data for year: ${year}`);
    console.log(`Total area: ${totalAreaHa.toFixed(2)} ha`);

    // Get biomass data (AGB and BGB) using full year
    // Get biomass data — drone pipeline if CIDs provided, else satellite
    console.log(`Fetching biomass data...`);
    let biomassData: { agb: number; bgb: number };
    let agbSource: 'drone' | 'satellite' = 'satellite';

    if (droneData?.orthomosaicCid && droneData?.chmCid) {
      console.log(`🚁 Using drone pipeline for AGB (year ${year})`);
      biomassData = await getDroneAGBData(droneData.orthomosaicCid, droneData.chmCid);
      agbSource = 'drone';
    } else {
      biomassData = await getBiomassData(geometry, year);
    }
    console.log(`Biomass data [${agbSource}]: AGB=${biomassData.agb} t/ha density, BGB=${biomassData.bgb} t/ha density`);

    // Get SOC data using full year
    console.log(`Fetching SOC data...`);
    const soc = await getSOCData(geometry, year);
    console.log(`SOC data: ${soc} t/ha density`);

    // Calculate total carbon density (t/ha) = AGB + BGB + SOC
    const carbonDensity = biomassData.agb + biomassData.bgb + soc;

    const agb_tonnes = biomassData.agb * totalAreaHa;
    const bgb_tonnes = biomassData.bgb * totalAreaHa;
    const soc_tonnes = soc * totalAreaHa;
    const totalCarbonStock = agb_tonnes + bgb_tonnes + soc_tonnes;
    const co2Equivalent = totalCarbonStock * 3.67;

    console.log(`Year ${year}: AGB=${agb_tonnes.toFixed(2)} t BGB=${bgb_tonnes.toFixed(2)} t SOC=${soc_tonnes.toFixed(2)} t Total=${totalCarbonStock.toFixed(2)} t CO2e=${co2Equivalent.toFixed(2)} t`);

    return {
      year,
      totalAreaHa: parseFloat(totalAreaHa.toFixed(2)),

      carbonPools: {
        agb: parseFloat(agb_tonnes.toFixed(2)),
        bgb: parseFloat(bgb_tonnes.toFixed(2)),
        soc: parseFloat(soc_tonnes.toFixed(2)),
      },
      totalCarbonDensity: parseFloat(carbonDensity.toFixed(2)),  // keep for reference
      totalCarbonStock: parseFloat(totalCarbonStock.toFixed(2)),
      co2Equivalent: parseFloat(co2Equivalent.toFixed(2)),
      agbSource,
    };
  } catch (error: any) {
    console.error(`Error fetching carbon data for year ${year}:`, error);
    throw new Error(`Failed to fetch carbon data for year ${year}: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      landId, polygonCoordinates, areaHectares, publicKey,
      startYear, endYear, isVerified, droneData,
      lastCarbonStockCo2e, lastAgbDensity, lastBgbDensity, lastSocDensity
    } = body;
    // Validate required parameters
    if (!landId || !polygonCoordinates || !areaHectares || !publicKey || !startYear || !endYear) {
      return NextResponse.json(
        {
          error: 'Missing required parameters',
          required: ['landId', 'polygonCoordinates', 'areaHectares', 'publicKey', 'startYear', 'endYear'],
          received: Object.keys(body)
        },
        { status: 400 }
      );
    }

    // Validate polygon coordinates
    if (!Array.isArray(polygonCoordinates) || polygonCoordinates.length < 3) {
      return NextResponse.json(
        { error: 'polygonCoordinates must be an array with at least 3 [longitude, latitude] pairs' },
        { status: 400 }
      );
    }

    // Validate that land is verified before calculating credits
    if (!isVerified) {
      return NextResponse.json(
        { error: 'Land must be verified by platform authority before calculating credits' },
        { status: 403 }
      );
    }

    // Validate year range
    if (startYear >= endYear) {
      return NextResponse.json(
        { error: 'startYear must be less than endYear' },
        { status: 400 }
      );
    }

    if (endYear > new Date().getFullYear()) {
      return NextResponse.json(
        { error: `endYear cannot be in the future (current year: ${new Date().getFullYear()})` },
        { status: 400 }
      );
    }

    // Validate area
    if (areaHectares <= 0) {
      return NextResponse.json(
        { error: 'areaHectares must be greater than 0' },
        { status: 400 }
      );
    }

    console.log(`🌍 Carbon monitoring request:`);
    console.log(`   Land ID: ${landId}`);
    console.log(`   Owner: ${publicKey}`);
    console.log(`   Period: ${startYear}-${endYear}`);
    console.log(`   Area: ${areaHectares} ha`);
    console.log(`   Polygon coordinates: ${polygonCoordinates.length} vertices`);

    // Use coordinates from on-chain storage
    const geometryData = {
      type: "Polygon",
      coordinates: [polygonCoordinates]
    } as GeometryData;

    // ✅ Validate geometry coordinates
    if (!Array.isArray(geometryData.coordinates) || geometryData.coordinates.length === 0) {
      return NextResponse.json(
        { error: 'Invalid geometry: no coordinates found' },
        { status: 400 }
      );
    }

    const geometry = {
      type: geometryData.type,
      coordinates: geometryData.coordinates,
    };

    console.log(`Fetching carbon monitoring data for years ${startYear} to ${endYear}`);

    // Calculate polygon area once for consistency
    const totalAreaHa = await calculatePolygonArea(geometry);
    console.log(`Polygon area from satellite: ${totalAreaHa.toFixed(2)} ha`);
    console.log(`Registered area from blockchain: ${areaHectares.toFixed(2)} ha`);

    // ✅ Warn if satellite-calculated area differs significantly from registered area
    const areaDiff = Math.abs(totalAreaHa - areaHectares) / areaHectares * 100;
    if (areaDiff > 10) {
      console.warn(`⚠️ Area mismatch: Satellite=${totalAreaHa.toFixed(2)} ha vs Registered=${areaHectares.toFixed(2)} ha (${areaDiff.toFixed(1)}% difference)`);
    }

    // Use registered area from blockchain for consistency
    const areaForCalculation = areaHectares;

    // If land has a previous calculation, skip startYear fetch
    const previousCo2e = body.lastCarbonStockCo2e ?? 0;

    // If previous calculation exists, use on-chain data as startYear
    let startData;
    const hasPreviousCalc = lastCarbonStockCo2e && lastCarbonStockCo2e > 0;

    if (hasPreviousCalc) {
      console.log(`♻️ Using on-chain previous record as startYear — skipping satellite fetch`);

      const lastAgbTonnes = (lastAgbDensity ?? 0) * areaForCalculation;
      const lastBgbTonnes = (lastBgbDensity ?? 0) * areaForCalculation;
      const lastSocTonnes = (lastSocDensity ?? 0) * areaForCalculation;
      const lastTotalDensity = (lastAgbDensity ?? 0) + (lastBgbDensity ?? 0) + (lastSocDensity ?? 0);

      startData = {
        year: startYear,
        totalAreaHa: areaForCalculation,
        carbonPools: {
          agb: parseFloat(lastAgbTonnes.toFixed(2)),
          bgb: parseFloat(lastBgbTonnes.toFixed(2)),
          soc: parseFloat(lastSocTonnes.toFixed(2)),
        },
        totalCarbonDensity: parseFloat(lastTotalDensity.toFixed(2)),  // t/ha, kept for reference
        totalCarbonStock: parseFloat((lastCarbonStockCo2e / 3.67).toFixed(2)),
        co2Equivalent: lastCarbonStockCo2e,
        agbSource: 'satellite' as const,
      };
    } else {
      console.log(`🛰️ First calculation — fetching startYear from satellite`);
      startData = await getCarbonDataForYear(geometry, startYear, areaForCalculation);
    }

    // ── Satellite pipeline for endYear first (no drone) ───────────────────────
    console.log(`🛰️ Fetching satellite data for endYear ${endYear}...`);
    const endDataSatellite = await getCarbonDataForYear(geometry, endYear, areaForCalculation);

    // ── Drone pipeline for endYear after satellite completes ──────────────────
    let endData = endDataSatellite;
    if (droneData?.orthomosaicCid && droneData?.chmCid) {
      console.log(`🚁 Satellite complete — now starting drone pipeline for endYear ${endYear}...`);
      try {
        const droneResult = await getDroneAGBData(droneData.orthomosaicCid, droneData.chmCid);

        // Fuse satellite AGB + drone AGB using inverse variance weighting
        const satVar = Math.max(endDataSatellite.carbonPools.agb * 0.1, 0.01) ** 2;
        const droneVar = Math.max(droneResult.agb_uncertainty, 0.01) ** 2;
        const wSat = 1 / satVar;
        const wDrone = 1 / droneVar;
        const fusedAgb = (wSat * endDataSatellite.carbonPools.agb + wDrone * droneResult.agb) / (wSat + wDrone);
        const fusedBgb = fusedAgb * 0.2;

        const fusedStockTc = fusedAgb + fusedBgb + endDataSatellite.carbonPools.soc;
        const fusedCo2e = fusedStockTc * 3.67;
        // keep density for reference by dividing back
        const fusedTotalDensity = fusedStockTc / areaForCalculation;

        endData = {
          ...endDataSatellite,
          carbonPools: {
            agb: parseFloat(fusedAgb.toFixed(2)),
            bgb: parseFloat(fusedBgb.toFixed(2)),
            soc: endDataSatellite.carbonPools.soc,   // already tonnes
          },
          totalCarbonDensity: parseFloat(fusedTotalDensity.toFixed(2)),  // t/ha, for reference
          totalCarbonStock: parseFloat(fusedStockTc.toFixed(2)),
          co2Equivalent: parseFloat(fusedCo2e.toFixed(2)),
          agbSource: 'drone' as const,
        };

        console.log(`✅ Fusion complete — Sat AGB=${endDataSatellite.carbonPools.agb} t Drone AGB=${droneResult.agb} t Fused AGB=${fusedAgb.toFixed(2)} t`);
      } catch (droneErr: any) {
        console.warn(`⚠️ Drone pipeline failed — falling back to satellite only: ${droneErr.message}`);
        endData = endDataSatellite;
      }
    }

    // Calculate time period
    const yearsDifference = endYear - startYear;
    const daysDifference = yearsDifference * 365;

    // ─── Carbon Stock Change Calculation ─────────────────────────────────────
    // Step 1: Subtract start year total from end year total to get change
    const carbonStockChange = endData.totalCarbonStock - startData.totalCarbonStock;

    // Step 2: If positive, convert to CO2 equivalent (1 tonne C = 3.67 tonne CO2e)
    const carbonStockChangeInCO2e = carbonStockChange * 3.67;

    // Step 3: Credits allocated = CO2e change (only if positive)
    // ⚠️ IMPORTANT: Use Math.floor (truncation) to match Rust contract behavior (as u64)
    // This ensures certificate credits match blockchain minted credits
    const creditsAllocated = carbonStockChange > 0 ? Math.floor(carbonStockChangeInCO2e) : 0;

    const carbonStockChangePercent = startData.totalCarbonStock > 0
      ? (carbonStockChange / startData.totalCarbonStock) * 100
      : 0;
    const annualCarbonChange = yearsDifference > 0
      ? carbonStockChange / yearsDifference
      : 0;

    return NextResponse.json({
      success: true,
      data: {
        // Land information
        land: {
          landId,
          owner: publicKey,
          areaHectares: areaForCalculation,
          isVerified,
        },
        // Carbon stock for start year
        startYear: startData,
        // Carbon stock for end year
        endYear: endData,
        // Carbon stock change analysis
        carbonChange: {
          // Per hectare density changes (deltas)
          agbChange: parseFloat((endData.carbonPools.agb - startData.carbonPools.agb).toFixed(2)),
          bgbChange: parseFloat((endData.carbonPools.bgb - startData.carbonPools.bgb).toFixed(2)),
          socChange: parseFloat((endData.carbonPools.soc - startData.carbonPools.soc).toFixed(2)),
          densityChange: parseFloat((endData.totalCarbonDensity - startData.totalCarbonDensity).toFixed(2)),
          // Total carbon stock changes (entire land area)
          totalChange: parseFloat(carbonStockChange.toFixed(2)),                    // tonnes C
          percentChange: parseFloat(carbonStockChangePercent.toFixed(2)),
          annualChange: parseFloat(annualCarbonChange.toFixed(2)),
          co2EquivalentChange: parseFloat(carbonStockChangeInCO2e.toFixed(2)),      // tonnes CO2e
          creditsAllocated: creditsAllocated,                                        // truncated integer, matches contract
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
          hectares: areaForCalculation,
          squareMeters: areaForCalculation * 10000,
        },
        // Metadata
        metadata: {
          analysisDate: new Date().toISOString(),
          coordinateSystem: 'EPSG:4326',
          dataSource: {
            coordinates: 'Fetched from IPFS (stored during land registration)',
            area: 'From registered land record on Solana blockchain',
            satelliteImagery: 'Sentinel-1, Sentinel-2, SRTM, CHIRPS, ERA5-Land, OpenLandMap',
          },
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
    console.error('❌ Error in carbon monitoring:', error);

    // Extract error message safely
    const errorMsg = error?.message || String(error) || 'Unknown error';
    let statusCode = 500;
    let userMessage = '';
    let diagnostics = '';

    // Provide specific error guidance
    if (errorMsg.includes('Earth Engine') || errorMsg.includes('initialize')) {
      statusCode = 503;
      userMessage = 'Earth Engine API connection failed. This may be due to network issues or invalid credentials.';
      diagnostics = 'Check that GEE_PRIVATE_KEY, GEE_SERVICE_ACCOUNT_EMAIL, and GEE_PROJECT_ID environment variables are set correctly.';
    } else if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('connect')) {
      statusCode = 503;
      userMessage = 'Network connection error. Unable to reach required services.';
      diagnostics = 'Check internet connectivity and that firewall allows access to Google Earth Engine API.';
    } else if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
      statusCode = 504;
      userMessage = 'Request timed out. Try again with a smaller area or different time period.';
      diagnostics = 'Earth Engine operations may be taking too long. The system has a 90-120 second timeout.';
    } else if (errorMsg.includes('No data') || errorMsg.includes('No Sentinel')) {
      statusCode = 400;
      userMessage = 'No satellite data available for the specified location and time period.';
      diagnostics = 'Try selecting a different location or earlier year when satellite imagery is more available.';
    } else if (errorMsg.includes('verified')) {
      statusCode = 403;
      userMessage = 'Land must be verified by platform authority before calculating credits.';
      diagnostics = 'Ensure the land record is marked as verified on the Solana blockchain.';
    } else if (errorMsg.includes('Model server')) {
      statusCode = 503;
      userMessage = 'ML model server is not running.';
      diagnostics = 'Start the model server with: cd frontend/ml && source venv/bin/activate && python3 model_server.py';
    }

    return NextResponse.json(
      {
        success: false,
        error: userMessage || errorMsg,
        details: errorMsg,
        diagnostics: diagnostics || 'Check server logs for more information',
      },
      { status: statusCode }
    );
  }
}
getDroneAGBData