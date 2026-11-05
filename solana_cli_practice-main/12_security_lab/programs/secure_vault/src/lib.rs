//! ✅ FIXED version of ../vulnerable_vault — Week 12 Security & Exploit Lab.
//!
//! Same interface, same account layouts. Each planted bug is fixed at the place marked "FIX":
//!   FIX-1 `authority: Signer`                        (missing signer check)
//!   FIX-2 seeds + `has_one = owner` on from_ledger   (missing ownership link)
//!   FIX-3 `checked_sub` + explicit balance check     (unchecked arithmetic)
//!   FIX-4 `Account<Config>` + seeds + has_one admin  (type cosplay: discriminator + owner checked)
use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("6igRCJBV2PQaEkVnLhLfe71tUsWdktA11dcebVKnCSEh");

#[program]
pub mod secure_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.config.admin = ctx.accounts.admin.key();
        ctx.accounts.config.bump = ctx.bumps.config;
        ctx.accounts.vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn open_ledger(ctx: Context<OpenLedger>) -> Result<()> {
        let ledger = &mut ctx.accounts.ledger;
        ledger.owner = ctx.accounts.owner.key();
        ledger.balance = 0;
        ledger.bump = ctx.bumps.ledger;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;
        let ledger = &mut ctx.accounts.ledger;
        ledger.balance = ledger.balance.checked_add(amount).ok_or(VaultError::Overflow)?;
        ctx.accounts.vault.total_deposits = ctx.accounts.vault.total_deposits.checked_add(amount).ok_or(VaultError::Overflow)?;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let ledger = &mut ctx.accounts.ledger;
        // FIX-3: explicit business check + checked arithmetic (defense in depth).
        require!(ledger.balance >= amount, VaultError::InsufficientBalance);
        ledger.balance = ledger.balance.checked_sub(amount).ok_or(VaultError::InsufficientBalance)?;
        ctx.accounts.vault.total_deposits = ctx.accounts.vault.total_deposits.checked_sub(amount).ok_or(VaultError::Overflow)?;
        move_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.destination, amount)
    }

    pub fn transfer_credit(ctx: Context<TransferCredit>, amount: u64) -> Result<()> {
        let from = &mut ctx.accounts.from_ledger;
        require!(from.balance >= amount, VaultError::InsufficientBalance);
        from.balance -= amount;
        let to = &mut ctx.accounts.to_ledger;
        to.balance = to.balance.checked_add(amount).ok_or(VaultError::Overflow)?;
        Ok(())
    }

    pub fn emergency_withdraw(ctx: Context<EmergencyWithdraw>, amount: u64) -> Result<()> {
        // FIX-4: all checks happen declaratively in the Accounts struct.
        move_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.admin.to_account_info(), amount)
    }
}

fn move_lamports<'info>(from: &AccountInfo<'info>, to: &AccountInfo<'info>, amount: u64) -> Result<()> {
    **from.try_borrow_mut_lamports()? = from.lamports().checked_sub(amount).ok_or(VaultError::InsufficientVaultFunds)?;
    **to.try_borrow_mut_lamports()? = to.lamports().checked_add(amount).ok_or(VaultError::Overflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Vault::INIT_SPACE, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenLedger<'info> {
    #[account(init, payer = owner, space = 8 + UserLedger::INIT_SPACE, seeds = [b"ledger", owner.key().as_ref()], bump)]
    pub ledger: Account<'info, UserLedger>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"vault"], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"ledger", owner.key().as_ref()], bump = ledger.bump)]
    pub ledger: Account<'info, UserLedger>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"vault"], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [b"ledger", authority.key().as_ref()],
        bump = ledger.bump,
        constraint = ledger.owner == authority.key() @ VaultError::Unauthorized
    )]
    pub ledger: Account<'info, UserLedger>,
    /// FIX-1: the ledger owner must sign.
    pub authority: Signer<'info>,
    /// CHECK: receives the withdrawn lamports; any destination chosen by the signer is fine.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TransferCredit<'info> {
    // FIX-2: from_ledger must be the PDA of the signer AND record the signer as owner.
    #[account(mut, seeds = [b"ledger", owner.key().as_ref()], bump = from_ledger.bump, has_one = owner)]
    pub from_ledger: Account<'info, UserLedger>,
    #[account(mut, seeds = [b"ledger", to_ledger.owner.as_ref()], bump = to_ledger.bump)]
    pub to_ledger: Account<'info, UserLedger>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
    // FIX-4: typed account → owner + 8-byte discriminator are verified (a UserLedger is rejected),
    // seeds pin it to the one real config PDA, has_one binds the signer to config.admin.
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"vault"], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub total_deposits: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserLedger {
    pub owner: Pubkey,
    pub balance: u64,
    pub bump: u8,
}

#[error_code]
pub enum VaultError {
    #[msg("Insufficient ledger balance")]
    InsufficientBalance,
    #[msg("Vault does not hold enough lamports")]
    InsufficientVaultFunds,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
}
