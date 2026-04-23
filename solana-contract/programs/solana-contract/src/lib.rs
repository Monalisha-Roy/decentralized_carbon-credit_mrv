use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

declare_id!("4XgM7JHxi24iXdAs2ykKrWtwZXM9X5rfxKd8dcUZk8Kr");

// 1 tonne C = 3.667 tonnes CO2e
const CO2E_FACTOR: f64 = 3.667;

#[program]
pub mod solana_contract {
    use super::*;

    pub fn initialize_platform(ctx: Context<InitializePlatform>) -> Result<()> {
        let platform = &mut ctx.accounts.platform_state;
        platform.authority = ctx.accounts.authority.key();
        platform.token_mint = ctx.accounts.token_mint.key();
        platform.bump = ctx.bumps.platform_state;
        platform.mint_bump = ctx.bumps.token_mint;
        msg!("Platform initialized. Authority: {}", platform.authority);
        Ok(())
    }

    pub fn register_land(
        ctx: Context<RegisterLand>,
        land_id: String,
        polygon_coordinates: Vec<Vec<f64>>,
        document_cid: String,
        area_hectares: f64,
    ) -> Result<()> {
        require!(land_id.len() <= 64, ErrorCode::LandIdTooLong);
        require!(polygon_coordinates.len() >= 3, ErrorCode::InvalidCoordinates);
        require!(document_cid.len() <= 128, ErrorCode::CidTooLong);
        require!(area_hectares > 0.0, ErrorCode::InvalidArea);

        for coord in &polygon_coordinates {
            require!(coord.len() == 2, ErrorCode::InvalidCoordinates);
        }

        let land = &mut ctx.accounts.land_record;
        land.owner = ctx.accounts.owner.key();
        land.land_id = land_id.clone();
        land.polygon_coordinates = polygon_coordinates;
        land.document_cid = document_cid;
        land.area_hectares = area_hectares;
        land.is_verified = false;
        land.is_declined = false;
        land.rejection_reason = String::new();
        land.last_calculated_year = 0;
        land.total_credits_minted = 0;
        land.calculation_count = 0;
        land.last_carbon_stock_co2e = 0.0; // FIX: initialize baseline tracker
        land.bump = ctx.bumps.land_record;

        msg!("Land registered: {} by {}", land_id, land.owner);
        Ok(())
    }

    pub fn verify_land(ctx: Context<VerifyLand>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.platform_state.authority,
            ErrorCode::Unauthorized
        );
        let land = &mut ctx.accounts.land_record;
        require!(!land.is_verified, ErrorCode::AlreadyVerified);
        require!(!land.is_declined, ErrorCode::AlreadyDeclined);
        land.is_verified = true;
        msg!("Land verified: {}", land.land_id);
        Ok(())
    }

    pub fn decline_land(ctx: Context<DeclineLand>, reason: String) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.platform_state.authority,
            ErrorCode::Unauthorized
        );
        require!(reason.len() <= 128, ErrorCode::ReasonTooLong);

        let land = &mut ctx.accounts.land_record;
        require!(!land.is_verified, ErrorCode::AlreadyVerified);
        require!(!land.is_declined, ErrorCode::AlreadyDeclined);

        land.is_declined = true;
        land.rejection_reason = reason.clone();
        msg!("Land {} declined. Reason: {}", land.land_id, reason);
        Ok(())
    }

    pub fn calculate_and_mint(
        ctx: Context<CalculateAndMint>,
        land_id: String,
        year: u16,
        agb_density: f64,  // CHANGE in AGB density (t/ha) — end minus start year
        bgb_density: f64,  // CHANGE in BGB density (t/ha) — end minus start year
        soc_density: f64,  // CHANGE in SOC density (t/ha) — end minus start year
    ) -> Result<()> {
        let land = &mut ctx.accounts.land_record;

        require!(
            ctx.accounts.authority.key() == ctx.accounts.platform_state.authority
                || ctx.accounts.authority.key() == land.owner,
            ErrorCode::Unauthorized
        );
        require!(land.is_verified, ErrorCode::LandNotVerified);
        require!(!land.is_declined, ErrorCode::LandDeclined);

        if land.last_calculated_year != 0 {
            require!(year > land.last_calculated_year, ErrorCode::TooSoon);
        }

        // ── Step 1: Sum the delta densities (end - start from off-chain ML) ──────
        let total_carbon_density_change = agb_density + bgb_density + soc_density;

        // ── Step 2: Multiply delta density by area to get total carbon change (tC) 
        let carbon_stock_change_tc = total_carbon_density_change * land.area_hectares;

        // ── Step 3: Convert tC change to CO2e ────────────────────────────────────
        let carbon_stock_change_co2e = carbon_stock_change_tc * CO2E_FACTOR;

        // ── Step 4: Only mint credits if carbon increased, record 0 otherwise ────
        // Zero and negative deltas are recorded on-chain but no tokens are minted
        let credits_to_mint = if carbon_stock_change_co2e > 0.0 {
            carbon_stock_change_co2e as u64
        } else {
            0u64
        };

        // ── Write CarbonRecord PDA ────────────────────────────────────────────────
        let carbon = &mut ctx.accounts.carbon_record;
        carbon.land_id = land_id.clone();
        carbon.year = year;
        carbon.agb_density = agb_density;
        carbon.bgb_density = bgb_density;
        carbon.soc_density = soc_density;
        carbon.total_carbon_density = total_carbon_density_change;
        carbon.carbon_stock_tc = carbon_stock_change_tc;
        carbon.carbon_stock_co2e = carbon_stock_change_co2e;
        carbon.previous_carbon_stock_co2e = land.last_carbon_stock_co2e;
        carbon.credits_minted = credits_to_mint;
        carbon.timestamp = Clock::get()?.unix_timestamp;
        carbon.authority = ctx.accounts.authority.key();
        carbon.sequence_index = land.calculation_count;
        carbon.bump = ctx.bumps.carbon_record;

        // ── Update LandRecord ─────────────────────────────────────────────────────
        land.last_calculated_year = year;
        land.last_carbon_stock_co2e = carbon_stock_change_co2e;
        land.total_credits_minted = land
            .total_credits_minted
            .checked_add(credits_to_mint)
            .ok_or(ErrorCode::Overflow)?;
        land.calculation_count = land
            .calculation_count
            .checked_add(1)
            .ok_or(ErrorCode::Overflow)?;

        // ── Mint SPL tokens only if credits > 0 ──────────────────────────────────
        if credits_to_mint > 0 {
            let seeds = &[b"platform".as_ref(), &[ctx.accounts.platform_state.bump]];
            let signer = &[&seeds[..]];

            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.platform_state.to_account_info(),
                },
                signer,
            );
            token::mint_to(cpi_ctx, credits_to_mint)?;
        }

        msg!(
            "Land: {} | Year: {} | Carbon Δ: {:.2} tC ({:.2} tCO2e) | Credits minted: {} | Lifetime total: {}",
            land_id,
            year,
            carbon_stock_change_tc,
            carbon_stock_change_co2e,
            credits_to_mint,
            land.total_credits_minted
        );
        Ok(())
    }
}

// ─── Account Structs ─────────────────────────────────────────────────────────

#[account]
pub struct PlatformState {
    pub authority: Pubkey,  // 32
    pub token_mint: Pubkey, // 32
    pub bump: u8,           // 1
    pub mint_bump: u8,      // 1
}
// space = 8 + 32 + 32 + 1 + 1 = 74

#[account]
pub struct LandRecord {
    pub owner: Pubkey,
    pub land_id: String,
    pub polygon_coordinates: Vec<Vec<f64>>,
    pub document_cid: String,
    pub area_hectares: f64,
    pub is_verified: bool,
    pub is_declined: bool,
    pub rejection_reason: String,
    pub last_calculated_year: u16,
    pub total_credits_minted: u64,
    pub calculation_count: u32,
    pub last_carbon_stock_co2e: f64, // FIX: baseline for next delta calculation
    pub bump: u8,
}

#[account]
pub struct CarbonRecord {
    pub land_id: String,                   // 4 + 64 = 68
    pub year: u16,                         // 2
    pub agb_density: f64,                  // 8
    pub bgb_density: f64,                  // 8
    pub soc_density: f64,                  // 8
    pub total_carbon_density: f64,         // 8
    pub carbon_stock_tc: f64,              // 8  — absolute tonnes Carbon
    pub carbon_stock_co2e: f64,            // 8  — absolute tonnes CO2e
    pub previous_carbon_stock_co2e: f64,   // 8  FIX: baseline used for delta calc
    pub credits_minted: u64,               // 8  — delta-based credits
    pub timestamp: i64,                    // 8
    pub authority: Pubkey,                 // 32
    pub sequence_index: u32,               // 4  — 0-based position in history
    pub bump: u8,                          // 1
}
// space = 8 + 68 + 2 + (8*8) + 8 + 8 + 32 + 4 + 1 = 195

// ─── Contexts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 1 + 1,
        seeds = [b"platform"],
        bump
    )]
    pub platform_state: Account<'info, PlatformState>,

    #[account(
        init,
        payer = authority,
        seeds = [b"mint"],
        bump,
        mint::decimals = 0,
        mint::authority = platform_state,
    )]
    pub token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(land_id: String, polygon_coordinates: Vec<Vec<f64>>)]
pub struct RegisterLand<'info> {
    #[account(
        init,
        payer = owner,
        space = 8                                              // discriminator
            + 32                                              // owner: Pubkey
            + (4 + 64)                                        // land_id: String (max 64)
            + 4 + (polygon_coordinates.len() * (4 + 2 * 8))  // Vec<Vec<f64>>
            + (4 + 128)                                       // document_cid: String (max 128)
            + 8                                               // area_hectares: f64
            + 1                                               // is_verified: bool
            + 1                                               // is_declined: bool
            + (4 + 128)                                       // rejection_reason: String (max 128)
            + 2                                               // last_calculated_year: u16
            + 8                                               // total_credits_minted: u64
            + 4                                               // calculation_count: u32
            + 8                                               // FIX: last_carbon_stock_co2e: f64
            + 1,                                              // bump: u8
        seeds = [b"land", land_id.as_bytes()],
        bump
    )]
    pub land_record: Account<'info, LandRecord>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyLand<'info> {
    #[account(seeds = [b"platform"], bump = platform_state.bump)]
    pub platform_state: Account<'info, PlatformState>,
    #[account(mut)]
    pub land_record: Account<'info, LandRecord>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeclineLand<'info> {
    #[account(seeds = [b"platform"], bump = platform_state.bump)]
    pub platform_state: Account<'info, PlatformState>,
    #[account(mut)]
    pub land_record: Account<'info, LandRecord>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(land_id: String, year: u16)]
pub struct CalculateAndMint<'info> {
    #[account(seeds = [b"platform"], bump = platform_state.bump)]
    pub platform_state: Account<'info, PlatformState>,

    #[account(
        mut,
        seeds = [b"land", land_id.as_bytes()],
        bump = land_record.bump
    )]
    pub land_record: Account<'info, LandRecord>,

    #[account(
        init,
        payer = authority,
        // FIX: space updated for extra f64 (previous_carbon_stock_co2e = +8 bytes)
        // 8 disc + 68 land_id + 2 year + 8*8 f64 fields + 8 credits + 8 ts + 32 authority + 4 seq + 1 bump
        space = 8 + (4 + 64) + 2 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 32 + 4 + 1,
        seeds = [b"carbon", land_id.as_bytes(), &year.to_le_bytes()],
        bump
    )]
    pub carbon_record: Account<'info, CarbonRecord>,

    #[account(
        mut,
        seeds = [b"mint"],
        bump = platform_state.mint_bump
    )]
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = land_record.owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Land ID exceeds 64 characters")]
    LandIdTooLong,
    #[msg("IPFS CID exceeds 128 characters")]
    CidTooLong,
    #[msg("Area must be > 0")]
    InvalidArea,
    #[msg("Density values must be >= 0")]
    InvalidDensity,
    #[msg("Land is not verified")]
    LandNotVerified,
    #[msg("Land is already verified")]
    AlreadyVerified,
    #[msg("Land is already declined")]
    AlreadyDeclined,
    #[msg("Minimum 1-year gap between calculations")]
    TooSoon,
    #[msg("Rejection reason exceeds 128 characters")]
    ReasonTooLong,
    #[msg("Land was declined")]
    LandDeclined,
    #[msg("Invalid polygon: need ≥3 [lon, lat] pairs")]
    InvalidCoordinates,
    #[msg("Integer overflow")]
    Overflow,
    #[msg("No carbon increase detected - credits only allocated for carbon gains")]
    NoCarbonIncrease,
}