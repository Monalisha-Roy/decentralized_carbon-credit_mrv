use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

declare_id!("3r12bmzVY7xhree24XEgyeKTymfZr1Lrd1jzZ9AHkWzY");

#[program]
pub mod solana_contract {
    use super::*;

    pub fn initialize_platform(ctx: Context<InitializePlatform>) -> Result<()> {
        let platform = &mut ctx.accounts.platform_state;
        platform.authority = ctx.accounts.authority.key();
        platform.token_mint = ctx.accounts.token_mint.key();
        platform.bump = ctx.bumps.platform_state;
        msg!("Platform initialized. Authority: {}", platform.authority);
        Ok(())
    }

    pub fn register_land(
        ctx: Context<RegisterLand>,
        land_id: String,
        ipfs_cid: String,
        area_hectares: f64,
    ) -> Result<()> {
        require!(land_id.len() <= 64, ErrorCode::LandIdTooLong);
        require!(ipfs_cid.len() <= 128, ErrorCode::CidTooLong);
        require!(area_hectares > 0.0, ErrorCode::InvalidArea);

        let land = &mut ctx.accounts.land_record;
        land.owner = ctx.accounts.owner.key();
        land.land_id = land_id.clone();
        land.ipfs_cid = ipfs_cid;
        land.area_hectares = area_hectares;
        land.is_verified = false;
        land.last_calculated_year = 0;
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

        land.is_verified = true;                          // ← was missing!
        msg!("Land verified: {}", land.land_id);
        Ok(())                                            // ← was missing!
    }

    pub fn calculate_and_mint(
        ctx: Context<CalculateAndMint>,
        land_id: String,
        year: u16,
        agb_density: f64,
        bgb_density: f64,
        soc_density: f64,
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.platform_state.authority,
            ErrorCode::Unauthorized
        );

        let land = &mut ctx.accounts.land_record;
        require!(land.is_verified, ErrorCode::LandNotVerified);

        if land.last_calculated_year != 0 {
            require!(year > land.last_calculated_year, ErrorCode::TooSoon);
            require!(year - land.last_calculated_year >= 1, ErrorCode::TooSoon);
        }

        let total_density = agb_density + bgb_density + soc_density;
        let carbon_stock = total_density * land.area_hectares;
        let credits_to_mint = carbon_stock as u64;

        let carbon = &mut ctx.accounts.carbon_record;
        carbon.land_id = land_id.clone();
        carbon.year = year;
        carbon.agb_density = agb_density;
        carbon.bgb_density = bgb_density;
        carbon.soc_density = soc_density;
        carbon.total_density = total_density;
        carbon.carbon_stock = carbon_stock;
        carbon.credits_minted = credits_to_mint;
        carbon.timestamp = Clock::get()?.unix_timestamp;
        carbon.bump = ctx.bumps.carbon_record;

        land.last_calculated_year = year;

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

        msg!(
            "Minted {} carbon credits for land {} (year {}). Carbon stock: {:.2} tonnes",
            credits_to_mint, land_id, year, carbon_stock
        );
        Ok(())
    }
}

#[account]
pub struct PlatformState {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub bump: u8,
}

#[account]
pub struct LandRecord {
    pub owner: Pubkey,
    pub land_id: String,
    pub ipfs_cid: String,
    pub area_hectares: f64,
    pub is_verified: bool,
    pub last_calculated_year: u16,
    pub bump: u8,
}

#[account]
pub struct CarbonRecord {
    pub land_id: String,
    pub year: u16,
    pub agb_density: f64,
    pub bgb_density: f64,
    pub soc_density: f64,
    pub total_density: f64,
    pub carbon_stock: f64,
    pub credits_minted: u64,              // ← comma not semicolon
    pub timestamp: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 1,
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
#[instruction(land_id: String)]
pub struct RegisterLand<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + (4 + 64) + (4 + 128) + 8 + 1 + 2 + 1,
        seeds = [b"land", land_id.as_bytes()],
        bump
    )]
    pub land_record: Account<'info, LandRecord>,

    #[account(mut)]
    pub owner: Signer<'info>,              // ← was "owener"
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
        space = 8 + (4 + 64) + 2 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1,
        seeds = [b"carbon", land_id.as_bytes(), &year.to_le_bytes()],
        bump
    )]
    pub carbon_record: Account<'info, CarbonRecord>,

    #[account(mut, seeds = [b"mint"], bump)]
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = land_record.owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,  // ← was Accounts

    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized: only platform authority can perform this action")]
    Unauthorized,
    #[msg("Land ID exceeds maximum length of 64 characters")]
    LandIdTooLong,
    #[msg("IPFS CID exceeds maximum length of 128 characters")]
    CidTooLong,
    #[msg("Area must be greater than 0")]
    InvalidArea,
    #[msg("Land is not verified yet")]
    LandNotVerified,
    #[msg("Already verified")]
    AlreadyVerified,
    #[msg("Minimum 1 year gap required between calculations")]
    TooSoon,
}