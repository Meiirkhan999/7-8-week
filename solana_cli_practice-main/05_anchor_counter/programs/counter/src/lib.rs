use anchor_lang::prelude::*;

declare_id!("BFAo2HceTs8EcDRMi9gLBCtiGXkVtGsG2AxEqEkYZ2PB");

#[program]
pub mod counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, initial_count: u64) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.authority.key();
        counter.count = initial_count;
        msg!("Counter initialized with authority {} and initial count {}", counter.authority, initial_count);
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>, step: u64) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        require_keys_eq!(
            counter.authority,
            ctx.accounts.authority.key(),
            CounterError::Unauthorized
        );

        counter.count = counter
            .count
            .checked_add(step)
            .ok_or(CounterError::ArithmeticOverflow)?;

        msg!("Counter incremented by {}. New count: {}", step, counter.count);
        Ok(())
    }

    pub fn reset(ctx: Context<Reset>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        require_keys_eq!(
            counter.authority,
            ctx.accounts.authority.key(),
            CounterError::Unauthorized
        );

        counter.count = 0;
        msg!("Counter reset to 0 by authority {}", counter.authority);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = Counter::LEN
    )]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut)]
    pub counter: Account<'info, Counter>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Reset<'info> {
    #[account(mut)]
    pub counter: Account<'info, Counter>,
    pub authority: Signer<'info>,
}

#[account]
pub struct Counter {
    pub authority: Pubkey, // 32
    pub count: u64,        // 8
}

impl Counter {
    pub const LEN: usize = 8 + 32 + 8; // 8 discriminator + 32 pubkey + 8 u64
}

#[error_code]
pub enum CounterError {
    #[msg("Unauthorized: Signer does not match counter authority")]
    Unauthorized,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
}
