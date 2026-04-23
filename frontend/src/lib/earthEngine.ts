import ee from '@google/earthengine';

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize Google Earth Engine with service account credentials
 */
export async function initializeEarthEngine(): Promise<void> {
  if (isInitialized) {
    return;
  }

  // If initialization is already in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = new Promise((resolve, reject) => {
    const privateKey = process.env.GEE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const serviceAccount = process.env.GEE_SERVICE_ACCOUNT_EMAIL;
    const projectId = process.env.GEE_PROJECT_ID;

    if (!privateKey || !serviceAccount || !projectId) {
      const missingVars = [];
      if (!privateKey) missingVars.push('GEE_PRIVATE_KEY');
      if (!serviceAccount) missingVars.push('GEE_SERVICE_ACCOUNT_EMAIL');
      if (!projectId) missingVars.push('GEE_PROJECT_ID');
      const error = new Error(`GEE credentials not configured. Missing environment variables: ${missingVars.join(', ')}`);
      console.error('❌', error.message);
      initializationPromise = null;
      reject(error);
      return;
    }

    console.log('🔄 Authenticating with Google Earth Engine...');
    console.log(`   Service Account: ${serviceAccount}`);
    console.log(`   Project ID: ${projectId}`);

    let initTimeout: NodeJS.Timeout | null = null;

    try {
      ee.data.authenticateViaPrivateKey(
        {
          client_email: serviceAccount,
          private_key: privateKey,
        },
        () => {
          console.log('✅ Authentication successful, initializing Earth Engine API...');
          // Initialize with cloud project - use the newer API format
          const baseUrl = 'https://earthengine.googleapis.com/api';
          ee.initialize(
            baseUrl,
            null,
            () => {
              isInitialized = true;
              if (initTimeout) clearTimeout(initTimeout);
              console.log('✅ Google Earth Engine initialized successfully');
              initializationPromise = null;
              resolve();
            },
            (error: Error) => {
              if (initTimeout) clearTimeout(initTimeout);
              console.error('❌ Failed to initialize Earth Engine API:', error);
              const errorMsg = error?.message || String(error) || 'Unknown initialization error';
              initializationPromise = null;
              // Provide better error context
              if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('connect')) {
                reject(new Error(`Cannot connect to Earth Engine API. Check network connectivity to earthengine.googleapis.com: ${errorMsg}`));
              } else if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
                reject(new Error(`Earth Engine authentication failed. Invalid credentials: ${errorMsg}`));
              } else {
                reject(new Error(`Earth Engine initialization failed: ${errorMsg}`));
              }
            }
          );
        },
        (error: Error) => {
          if (initTimeout) clearTimeout(initTimeout);
          console.error('❌ Failed to authenticate with Earth Engine:', error);
          const errorMsg = error?.message || String(error) || 'Unknown authentication error';
          initializationPromise = null;
          if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
            reject(new Error(`Invalid service account credentials: ${errorMsg}`));
          } else if (errorMsg.includes('private key')) {
            reject(new Error(`Invalid private key format: ${errorMsg}`));
          } else {
            reject(new Error(`Earth Engine authentication failed: ${errorMsg}`));
          }
        }
      );
    } catch (error: any) {
      if (initTimeout) clearTimeout(initTimeout);
      const errorMsg = error?.message || String(error) || 'Unknown error';
      console.error('❌ Error during Earth Engine initialization:', errorMsg);
      initializationPromise = null;
      reject(new Error(`Error initializing Earth Engine: ${errorMsg}`));
      return;
    }

    // Add a timeout for initialization
    initTimeout = setTimeout(() => {
      if (!isInitialized && initializationPromise) {
        console.error('❌ Earth Engine initialization timed out after 30 seconds');
        initializationPromise = null;
        reject(new Error('Earth Engine initialization timed out after 30 seconds. Check network connectivity.'));
      }
    }, 30000);
  });

  return initializationPromise;
}

/**
 * Ensure Earth Engine is initialized before use
 */
export async function ensureInitialized(): Promise<void> {
  if (!isInitialized) {
    await initializeEarthEngine();
  }
}

/**
 * Get Sentinel-2 imagery for a given polygon and date range
 */
export async function getSentinel2Data(
  geometry: any,
  startDate: string,
  endDate: string,
  cloudCoverMax: number = 20
) {
  await ensureInitialized();

  const polygon = ee.Geometry.Polygon(geometry.coordinates);

  // Load Sentinel-2 Surface Reflectance data
  const sentinel2 = new ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(polygon)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloudCoverMax));

  return sentinel2;
}

/**
 * Calculate NDVI (Normalized Difference Vegetation Index)
 */
export function calculateNDVI(image: any) {
  const ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  return image.addBands(ndvi);
}

/**
 * Calculate EVI (Enhanced Vegetation Index)
 */
export function calculateEVI(image: any) {
  const evi = image.expression(
    '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))',
    {
      NIR: image.select('B8'),
      RED: image.select('B4'),
      BLUE: image.select('B2'),
    }
  ).rename('EVI');
  return image.addBands(evi);
}

/**
 * Cloud masking for Sentinel-2
 */
export function maskS2Clouds(image: any) {
  const qa = image.select('QA60');
  const cloudBitMask = 1 << 10;
  const cirrusBitMask = 1 << 11;
  const mask = qa.bitwiseAnd(cloudBitMask).eq(0)
    .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
  return image.updateMask(mask).divide(10000);
}

export function calculateLAI(image: any) {
  const evi = image.select('EVI');
    const lai = evi.multiply(3.618).subtract(0.118).clamp(0, 8).rename('LAI');
    return image.addBands(lai);
};

// Sentinel-2 visualization parameters
export const s2Visualizations = {
  trueColor: { bands: ['B4', 'B3', 'B2'], min: 0, max: 0.3 },
  ndvi: { bands: ['NDVI'], min: -1, max: 1, palette: ['red', 'yellow', 'green'] },
  evi: { bands: ['EVI'], min: -1, max: 1, palette: ['brown', 'yellow', 'green', 'darkgreen'] },
  lai: { bands: ['LAI'], min: 0, max: 6, palette: ['white', 'yellow', 'green', 'darkgreen'] },
};

// Get Dynamic World land cover (near real-time)
export async function getDynamicWorldLandCover(
  geometry: any,
  startDate: string,
  endDate: string
) {
  await ensureInitialized();

  const polygon = ee.Geometry.Polygon(geometry.coordinates);

  const dynamicWorld = new ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(polygon)
    .filterDate(startDate, endDate);

  return dynamicWorld;
}

/**
 * Check if an ImageCollection has any images
 */
export async function checkCollectionSize(collection: any): Promise<number> {
  await ensureInitialized();
  
  return new Promise((resolve, reject) => {
    collection.size().evaluate((size: number, error: any) => {
      if (error) {
        reject(error);
      } else {
        resolve(size);
      }
    });
  });
}

/**
 * Calculate area statistics for different land cover classes
 */
export async function calculateAreaStatistics(
  landcoverImage: any,
  geometry: any
): Promise<any> {
  await ensureInitialized();

  const polygon = ee.Geometry.Polygon(geometry.coordinates);

  // Select only the classification band (should be named 'classification')
  const classificationBand = landcoverImage.select('classification');

  // Calculate area for each class
  // Add pixel area as the first band, classification as the second band
  const areaImage = ee.Image.pixelArea().addBands(classificationBand);

  const areas = areaImage.reduceRegion({
    reducer: ee.Reducer.sum().group({
      groupField: 1,
      groupName: 'class',
    }),
    geometry: polygon,
    scale: 10,
    maxPixels: 1e13,
  });

  return new Promise((resolve, reject) => {
    areas.evaluate((result: any, error: any) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Get image as URL for visualization
 */
export async function getImageUrl(
  image: any,
  geometry: any,
  visParams: any
): Promise<string> {
  await ensureInitialized();

  const polygon = ee.Geometry.Polygon(geometry.coordinates);

  return new Promise((resolve, reject) => {
    image.getMap(visParams, (mapId: any, error: any) => {
      if (error) {
        console.error('Error getting map ID:', error);
        reject(error);
      } else if (!mapId) {
        console.error('Invalid mapId response:', mapId);
        reject(new Error('Failed to get valid map URL from Earth Engine'));
      } else {
        // Build the tile URL with {z}/{x}/{y} placeholders
        let url = mapId.urlFormat || mapId.url || '';
        
        // If the URL doesn't already have tile coordinates, append them
        if (!url.includes('{z}')) {
          // Remove trailing slash if present
          url = url.replace(/\/$/, '');
          // Add tile coordinate placeholders
          url = `${url}/tiles/{z}/{x}/{y}`;
        }
        
        console.log('Generated tile URL:', url);
        resolve(url);
      }
    });
  });
}

/**
 * Export processed data as GeoTIFF
 */
export async function exportToGeoTiff(
  image: any,
  geometry: any,
  description: string
): Promise<any> {
  await ensureInitialized();

  const polygon = ee.Geometry.Polygon(geometry.coordinates);

  const exportTask = ee.batch.Export.image.toDrive({
    image: image,
    description: description,
    scale: 10,
    region: polygon,
    fileFormat: 'GeoTIFF',
    maxPixels: 1e13,
  });

  return exportTask;
}