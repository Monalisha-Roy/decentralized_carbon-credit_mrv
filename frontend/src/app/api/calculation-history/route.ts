import { NextRequest, NextResponse } from 'next/server';
import * as web3 from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

/**
 * Calculation History API
 * Fetches all carbon credit calculations for a given land from the blockchain
 * Returns calculation details including authority, timestamps, and credits allocated
 */

interface CalculationRecord {
  year: number;
  agbDensity: number;
  bgbDensity: number;
  socDensity: number;
  totalDensity: number;
  carbonStock: number;
  creditsMinted: number;
  timestamp: number;
  authority: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const landId = searchParams.get('landId');
    const walletAddress = searchParams.get('wallet');

    if (!landId || !walletAddress) {
      return NextResponse.json(
        { error: 'Missing required parameters: landId and wallet' },
        { status: 400 }
      );
    }

    // Initialize Solana connection
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new web3.Connection(rpcUrl);

    // Get the program ID from IDL
    const programId = new web3.PublicKey('8fYcCBJkiV8JTzWcKLH32GAWsg85q7hYdq7H2BqkZg6q');

    // Fetch all carbon records for this land from the blockchain
    // This is done by scanning all carbon records and filtering by land_id
    const accounts = await connection.getProgramAccounts(programId, {
      dataSlice: { offset: 0, length: 1000 }, // Get full data
      filters: [
        {
          dataSize: 235, // Expected size of CarbonRecord after adding authority field
        },
      ],
    });

    const calculations: CalculationRecord[] = [];

    for (const account of accounts) {
      try {
        // Try to parse as CarbonRecord
        // Offset 8 is for the discriminator
        const data = account.account.data;
        
        // Parse land_id (String type: 4-byte length prefix + data)
        let offset = 8;
        const landIdLen = data.readUInt32LE(offset);
        offset += 4;
        const parsedLandId = data.toString('utf-8', offset, offset + landIdLen);
        offset += landIdLen;

        if (parsedLandId === landId) {
          // Parse the rest of the fields
          const year = data.readUInt16LE(offset);
          offset += 2;

          const agbDensity = data.readDoubleLE(offset);
          offset += 8;

          const bgbDensity = data.readDoubleLE(offset);
          offset += 8;

          const socDensity = data.readDoubleLE(offset);
          offset += 8;

          const totalDensity = data.readDoubleLE(offset);
          offset += 8;

          const carbonStock = data.readDoubleLE(offset);
          offset += 8;

          const creditsMinted = Number(data.readBigInt64LE(offset));
          offset += 8;

          const timestamp = Number(data.readBigInt64LE(offset));
          offset += 8;

          const authority = new web3.PublicKey(data.slice(offset, offset + 32)).toBase58();
          offset += 32;

          calculations.push({
            year,
            agbDensity,
            bgbDensity,
            socDensity,
            totalDensity,
            carbonStock,
            creditsMinted,
            timestamp,
            authority,
          });
        }
      } catch (error) {
        // Skip accounts that can't be parsed
        continue;
      }
    }

    // Sort by year descending
    calculations.sort((a, b) => b.year - a.year);

    return NextResponse.json(
      {
        success: true,
        landId,
        calculations,
        totalCreditsAllocated: calculations.reduce((sum, c) => sum + c.creditsMinted, 0),
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Error fetching calculation history:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch calculation history' },
      { status: 500 }
    );
  }
}
