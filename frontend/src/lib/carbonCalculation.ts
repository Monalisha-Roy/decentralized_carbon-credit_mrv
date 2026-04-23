/**
 * Carbon Credit Calculation Utility
 * Handles the flow of calculating carbon stock and credits for verified lands
 */

import { PublicKey } from '@solana/web3.js';

export interface CarbonCalculationRequest {
  landId: string;
  polygonCoordinates: Array<[number, number]>;  // Array of [longitude, latitude] pairs
  areaHectares: number;
  publicKey: string;
  startYear: number;
  endYear: number;
  isVerified: boolean;
}

export interface CarbonPoolData {
  agb: number; // Above Ground Biomass (tonnes/ha)
  bgb: number; // Below Ground Biomass (tonnes/ha)
  soc: number; // Soil Organic Carbon (tonnes/ha)
}

export interface CarbonDataPoint {
  year: number;
  totalAreaHa: number;
  carbonPools: CarbonPoolData;
  totalCarbonDensity: number; // Total carbon density (t/ha)
  totalCarbonStock: number; // Total carbon stock in tonnes
  co2Equivalent: number; // CO2 equivalent in tonnes
}

export interface CarbonChangeData {
  agbChange: number;
  bgbChange: number;
  socChange: number;
  densityChange: number;
  totalChange: number;
  percentChange: number;
  annualChange: number;
  co2EquivalentChange: number;
  status: 'Carbon Gain' | 'Carbon Loss' | 'No Change';
}

export interface CarbonMonitoringResponse {
  success: boolean;
  data?: {
    land: {
      landId: string;
      owner: string;
      areaHectares: number;
      isVerified: boolean;
    };
    startYear: CarbonDataPoint;
    endYear: CarbonDataPoint;
    carbonChange: CarbonChangeData;
    period: {
      startYear: number;
      endYear: number;
      durationYears: number;
    };
    area: {
      hectares: number;
      squareMeters: number;
    };
    metadata: {
      analysisDate: string;
      coordinateSystem: string;
      dataSource: Record<string, string>;
      formulas: Record<string, string>;
      models: Record<string, string>;
    };
  };
  error?: string;
  diagnostics?: string;
}

/**
 * Calculate carbon credits for a verified land
 * 
 * This function orchestrates the entire pipeline:
 * 1. Validates the land is verified
 * 2. Fetches satellite data from Earth Engine
 * 3. Runs ML models to predict carbon pools
 * 4. Returns comprehensive carbon analysis
 * 
 * @param request - Carbon calculation request parameters
 * @returns Carbon monitoring data with AGB, BGB, SOC predictions
 */
export async function calculateCarbonCredits(
  request: CarbonCalculationRequest
): Promise<CarbonMonitoringResponse> {
  try {
    // Validate request
    if (!request.landId || !request.polygonCoordinates || !request.publicKey) {
      throw new Error('Missing required land information');
    }

    if (!Array.isArray(request.polygonCoordinates) || request.polygonCoordinates.length < 3) {
      throw new Error('Polygon coordinates must be an array with at least 3 [longitude, latitude] pairs');
    }

    if (!request.isVerified) {
      throw new Error('Land must be verified by platform authority before calculating credits');
    }

    if (request.startYear >= request.endYear) {
      throw new Error('Start year must be before end year');
    }

    const currentYear = new Date().getFullYear();
    if (request.endYear > currentYear) {
      throw new Error(`End year cannot be in the future. Current year: ${currentYear}`);
    }

    if (request.areaHectares <= 0) {
      throw new Error('Area must be greater than 0');
    }

    console.log(`🌍 Initiating carbon calculation for land: ${request.landId}`);
    console.log(`   Owner: ${request.publicKey}`);
    console.log(`   Period: ${request.startYear} to ${request.endYear}`);
    console.log(`   Area: ${request.areaHectares} hectares`);

    // Call the carbon monitoring API
    const response = await fetch('/api/carbon-monitoring', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const message = errorData.error || `HTTP error! status: ${response.status}`;
      const diagnostics = errorData.diagnostics ? `\n${errorData.diagnostics}` : '';
      throw new Error(message + diagnostics);
    }

    const data: CarbonMonitoringResponse = await response.json();

    if (!data.success) {
      const message = data.error || 'Failed to calculate carbon credits';
      const diagnostics = data.diagnostics ? `\n${data.diagnostics}` : '';
      throw new Error(message + diagnostics);
    }

    console.log('✅ Carbon calculation completed successfully');
    console.log(`   AGB: ${data.data?.startYear.carbonPools.agb} t/ha`);
    console.log(`   SOC: ${data.data?.startYear.carbonPools.soc} t/ha`);
    console.log(`   Total Carbon: ${data.data?.startYear.totalCarbonStock} tonnes`);

    return data;
  } catch (error: any) {
    console.error('❌ Error calculating carbon credits:', error);
    const errorMsg = error?.message || String(error) || 'Failed to calculate carbon credits';
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Format carbon data for display
 */
export function formatCarbonData(data: CarbonDataPoint): string {
  return `
AGB: ${data.carbonPools.agb.toFixed(2)} t/ha
BGB: ${data.carbonPools.bgb.toFixed(2)} t/ha
SOC: ${data.carbonPools.soc.toFixed(2)} t/ha
Total Carbon Density: ${data.totalCarbonDensity.toFixed(2)} t/ha
Total Carbon Stock: ${data.totalCarbonStock.toFixed(2)} tonnes
CO₂ Equivalent: ${data.co2Equivalent.toFixed(2)} tonnes
  `.trim();
}

/**
 * Calculate carbon credits from carbon stock
 * Standard conversion: 1 tonne of carbon = 1 carbon credit (in many systems)
 * CO₂ equivalent: carbon × 3.67
 * 
 * @param totalCarbonStock - Total carbon in tonnes
 * @param creditPrice - Price per carbon credit in USD (optional)
 * @returns Carbon credits and optional value
 */
export function calculateCreditsFromCarbon(
  totalCarbonStock: number,
  creditPrice?: number
): { credits: number; value?: number } {
  const credits = totalCarbonStock;
  const result: any = { credits: parseFloat(credits.toFixed(2)) };

  if (creditPrice) {
    result.value = parseFloat((credits * creditPrice).toFixed(2));
  }

  return result;
}

/**
 * Get default calculation years for current context
 */
export function getDefaultCalculationYears(): { startYear: number; endYear: number } {
  const currentYear = new Date().getFullYear();
  return {
    startYear: currentYear - 1, // Use previous year if current isn't complete
    endYear: currentYear,
  };
}
