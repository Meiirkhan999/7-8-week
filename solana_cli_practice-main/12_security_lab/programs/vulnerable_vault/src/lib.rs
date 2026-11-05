//! ⚠️ INTENTIONALLY VULNERABLE — Week 12 Security & Exploit Lab. Never deploy this to mainnet.
//!
//! A shared SOL vault with per-user ledgers. Four planted bugs (search for "VULN"):
//!   VULN-1 Missing signer check            (withdraw: authority is not a Signer)
//!   VULN-2 Missing account ownership link  (transfer_credit: from_ledger not bound to owner)
//!   VULN-3 Unchecked arithmetic            (withdraw: wrapping_sub, no balance check)
//!   VULN-4 Type cosplay                    (emergency_withdraw: config read from raw bytes, no discriminator)
//! The fixed version lives in ../secure_vault — `diff` the two files to see each fix.
use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("7XjM99vjBopv1ExKGpjrW3sS9buTB29G6DJiMoHUdsW2");

#[program]
pub mod vulnerable_vault {
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
        // VULN-3: no `balance >= amount` check, and wrapping_sub silently underflows to ~u64::MAX.
        ledger.balance = ledger.balance.wrapping_sub(amount);
        ctx.accounts.vault.total_deposits = ctx.accounts.vault.total_deposits.wrapping_sub(amount);
        move_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.destination, amount)
    }

    /// Move internal credit from one ledger to another (e.g. paying a friend inside the vault).
    pub fn transfer_credit(ctx: Context<TransferCredit>, amount: u64) -> Result<()> {
        let from = &mut ctx.accounts.from_ledger;
        require!(from.balance >= amount, VaultError::InsufficientBalance);
        from.balance -= amount;
        let to = &mut ctx.accounts.to_ledger;
        to.balance = to.balance.checked_add(amount).ok_or(VaultError::Overflow)?;
        Ok(())
    }

    /// Admin-only escape hatch.
    pub fn emergency_withdraw(ctx: Context<EmergencyWithdraw>, amount: u64) -> Result<()> {
        // VULN-4: the program checks the account *owner* but deserializes it by hand, skipping
        // Anchor's 8-byte discriminator check. Any program-owned account whose first 32 bytes after
        // the discriminator are the attacker's key — e.g. the attacker's own UserLedger — "is" a Config.
        let info = &ctx.accounts.config;
        require_keys_eq!(*info.owner, crate::ID, VaultError::Unauthorized);
        let data = info.try_borrow_data()?;
        let config = <Config as AnchorDeserialize>::deserialize(&mut &data[8..])?;
        require_keys_eq!(config.admin, ctx.accounts.admin.key(), VaultError::Unauthorized);
        drop(data);
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
    #[account(mut, seeds = [b"ledger", authority.key().as_ref()], bump = ledger.bump)]
    pub ledger: Account<'info, UserLedger>,
    /// CHECK: VULN-1 — the ledger is correctly derived from `authority`, but nobody checks that
    /// `authority` actually signed. Anyone can pass the victim's pubkey here.
    pub authority: UncheckedAccount<'info>,
    /// CHECK: receives the withdrawn lamports.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TransferCredit<'info> {
    // VULN-2: `from_ledger` is any UserLedger — no seeds and no `has_one = owner`, so the signer
    // does not have to be the ledger's owner.
    #[account(mut)]
    pub from_ledger: Account<'info, UserLedger>,
    #[account(mut)]
    pub to_ledger: Account<'info, UserLedger>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
    /// CHECK: VULN-4 — raw AccountInfo, deserialized manually in the handler.
    pub config: UncheckedAccount<'info>,
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

/// Same leading layout as Config (a Pubkey first) — which is exactly what VULN-4 abuses.
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
