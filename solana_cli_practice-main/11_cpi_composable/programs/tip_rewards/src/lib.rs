//! Week 11 — CPI & composable applications.
//!
//! `tip_rewards` does not move SOL itself. One `tip_with_reward` instruction composes four
//! existing on-chain programs:
//!   1. tip_jar (module 08)            — CPI `tip`: SOL transfer + jar stats + TipReceivedEvent
//!   2. System Program                 — invoked by tip_jar (nested CPI, depth 2), pays the ATA rent
//!   3. Associated Token Account prog. — creates the tipper's reward ATA on first tip (init_if_needed)
//!   4. SPL Token Program              — `mint_to` reward tokens, signed by this program's PDA
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use tip_jar::cpi::accounts::SendTip;
use tip_jar::program::TipJar;
use tip_jar::TipJarAccount;

declare_id!("CQvQzgw8V9rFgAqmBS4E1qNCgQMHe7agWXhkKNwgZs8r");

pub const REWARD_DECIMALS: u8 = 6;
/// 100 reward tokens per 1 SOL tipped.
pub const REWARD_TOKENS_PER_SOL: u64 = 100;
pub const CONFIG_SEED: &[u8] = b"config";
pub const REWARD_MINT_SEED: &[u8] = b"reward_mint";
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint_authority";

/// reward base units = lamports * 100 tokens * 10^6 / 10^9 (u128 to avoid overflow).
pub fn reward_for(lamports: u64) -> Result<u64> {
    let units = (lamports as u128)
        .checked_mul(REWARD_TOKENS_PER_SOL as u128 * 10u128.pow(REWARD_DECIMALS as u32))
        .ok_or(RewardsError::ArithmeticOverflow)?
        / 1_000_000_000u128;
    u64::try_from(units).map_err(|_| error!(RewardsError::ArithmeticOverflow))
}

#[program]
pub mod tip_rewards {
    use super::*;

    pub fn init_rewards(ctx: Context<InitRewards>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.reward_mint = ctx.accounts.reward_mint.key();
        config.total_tips_routed = 0;
        config.total_lamports_routed = 0;
        config.total_rewards_minted = 0;
        config.bump = ctx.bumps.config;
        config.mint_authority_bump = ctx.bumps.mint_authority;
        msg!("Rewards initialized: mint {}", config.reward_mint);
        Ok(())
    }

    pub fn tip_with_reward(ctx: Context<TipWithReward>, amount: u64, message: String) -> Result<()> {
        let reward = reward_for(amount)?;
        require!(reward > 0, RewardsError::TipTooSmall);

        // CPI #1: tip_jar::tip. The tipper's signature is forwarded (signer privilege extends to CPI),
        // and tip_jar itself does a nested CPI into the System Program to move the lamports.
        tip_jar::cpi::tip(
            CpiContext::new(
                ctx.accounts.tip_jar_program.to_account_info(),
                SendTip {
                    jar: ctx.accounts.jar.to_account_info(),
                    tipper: ctx.accounts.tipper.to_account_info(),
                    recipient: ctx.accounts.recipient.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            amount,
            message,
        )?;

        // CPI #2: SPL Token mint_to, signed by the mint-authority PDA (invoke_signed under the hood).
        let bump = [ctx.accounts.config.mint_authority_bump];
        let signer_seeds: &[&[&[u8]]] = &[&[MINT_AUTHORITY_SEED, &bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.reward_mint.to_account_info(),
                    to: ctx.accounts.tipper_reward_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer_seeds,
            ),
            reward,
        )?;

        let config = &mut ctx.accounts.config;
        config.total_tips_routed = config.total_tips_routed.checked_add(1).ok_or(RewardsError::ArithmeticOverflow)?;
        config.total_lamports_routed = config
            .total_lamports_routed
            .checked_add(amount)
            .ok_or(RewardsError::ArithmeticOverflow)?;
        config.total_rewards_minted = config
            .total_rewards_minted
            .checked_add(reward)
            .ok_or(RewardsError::ArithmeticOverflow)?;

        emit!(RewardMintedEvent {
            tipper: ctx.accounts.tipper.key(),
            jar: ctx.accounts.jar.key(),
            tip_lamports: amount,
            reward_units: reward,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitRewards<'info> {
    #[account(init, payer = admin, space = RewardsConfig::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, RewardsConfig>,

    #[account(
        init,
        payer = admin,
        seeds = [REWARD_MINT_SEED],
        bump,
        mint::decimals = REWARD_DECIMALS,
        mint::authority = mint_authority,
    )]
    pub reward_mint: Account<'info, Mint>,

    /// CHECK: PDA with no data; only used as the mint authority signer.
    #[account(seeds = [MINT_AUTHORITY_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TipWithReward<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = reward_mint)]
    pub config: Account<'info, RewardsConfig>,

    /// Typed as tip_jar's account: Anchor checks owner == tip_jar program and the discriminator,
    /// so a fake "jar" owned by another program is rejected before the CPI even happens.
    #[account(mut)]
    pub jar: Account<'info, TipJarAccount>,

    /// CHECK: must be the jar owner (also re-checked by tip_jar during the CPI).
    #[account(mut, address = jar.owner @ RewardsError::InvalidRecipient)]
    pub recipient: UncheckedAccount<'info>,

    #[account(mut)]
    pub tipper: Signer<'info>,

    #[account(mut, seeds = [REWARD_MINT_SEED], bump)]
    pub reward_mint: Account<'info, Mint>,

    /// CHECK: PDA mint authority, verified by seeds.
    #[account(seeds = [MINT_AUTHORITY_SEED], bump = config.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = tipper,
        associated_token::mint = reward_mint,
        associated_token::authority = tipper,
    )]
    pub tipper_reward_account: Account<'info, TokenAccount>,

    pub tip_jar_program: Program<'info, TipJar>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct RewardsConfig {
    pub admin: Pubkey,                // 32
    pub reward_mint: Pubkey,          // 32
    pub total_tips_routed: u64,       // 8
    pub total_lamports_routed: u64,   // 8
    pub total_rewards_minted: u64,    // 8
    pub bump: u8,                     // 1
    pub mint_authority_bump: u8,      // 1
}

impl RewardsConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 1;
}

#[event]
pub struct RewardMintedEvent {
    pub tipper: Pubkey,
    pub jar: Pubkey,
    pub tip_lamports: u64,
    pub reward_units: u64,
}

#[error_code]
pub enum RewardsError {
    #[msg("Tip is too small to earn any reward")]
    TipTooSmall,
    #[msg("Recipient does not match the jar owner")]
    InvalidRecipient,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reward_math() {
        assert_eq!(reward_for(1_000_000_000).unwrap(), 100_000_000); // 1 SOL → 100 tokens
        assert_eq!(reward_for(500_000_000).unwrap(), 50_000_000); // 0.5 SOL → 50 tokens
        assert_eq!(reward_for(9).unwrap(), 0); // dust rounds down
        assert_eq!(reward_for(u64::MAX).unwrap(), u64::MAX / 10); // no overflow thanks to u128
    }
}
