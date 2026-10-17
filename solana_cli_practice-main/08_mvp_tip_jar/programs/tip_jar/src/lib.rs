use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("9WDzTpe9g8ifaqDQfwC24eXxMoQCttTafqP6wmfzPPXX");

pub const MAX_JAR_NAME_LEN: usize = 32;
pub const MAX_MESSAGE_LEN: usize = 128;

#[program]
pub mod tip_jar {
    use super::*;

    pub fn initialize_jar(ctx: Context<InitializeJar>, name: String) -> Result<()> {
        require!(!name.trim().is_empty(), TipJarError::EmptyJarName);
        require!(name.len() <= MAX_JAR_NAME_LEN, TipJarError::JarNameTooLong);

        let jar = &mut ctx.accounts.jar;
        jar.owner = ctx.accounts.owner.key();
        jar.name = name.clone();
        jar.total_tips = 0;
        jar.total_volume_lamports = 0;
        jar.bump = ctx.bumps.jar;

        msg!("Tip jar '{}' initialized for owner {}", name, jar.owner);
        Ok(())
    }

    pub fn tip(ctx: Context<SendTip>, amount: u64, message: String) -> Result<()> {
        require!(amount > 0, TipJarError::InvalidTipAmount);
        require!(message.len() <= MAX_MESSAGE_LEN, TipJarError::MessageTooLong);

        // Execute Native CPI Transfer from tipper to jar owner recipient
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.tipper.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        // Update Tip Jar statistics
        let jar = &mut ctx.accounts.jar;
        jar.total_tips = jar
            .total_tips
            .checked_add(1)
            .ok_or(TipJarError::ArithmeticOverflow)?;
        jar.total_volume_lamports = jar
            .total_volume_lamports
            .checked_add(amount)
            .ok_or(TipJarError::ArithmeticOverflow)?;

        // Emit TipReceivedEvent
        emit!(TipReceivedEvent {
            jar: jar.key(),
            tipper: ctx.accounts.tipper.key(),
            recipient: ctx.accounts.recipient.key(),
            amount,
            message: message.clone(),
            total_tips: jar.total_tips,
            total_volume_lamports: jar.total_volume_lamports,
        });

        msg!(
            "Tip received: {} lamports from {} to {}. Total tips: {}",
            amount,
            ctx.accounts.tipper.key(),
            ctx.accounts.recipient.key(),
            jar.total_tips
        );

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeJar<'info> {
    #[account(
        init,
        payer = owner,
        space = TipJarAccount::SPACE,
        seeds = [b"tip_jar", owner.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub jar: Account<'info, TipJarAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SendTip<'info> {
    #[account(
        mut,
        seeds = [b"tip_jar", jar.owner.as_ref(), jar.name.as_bytes()],
        bump = jar.bump
    )]
    pub jar: Account<'info, TipJarAccount>,

    #[account(mut)]
    pub tipper: Signer<'info>,

    /// CHECK: Recipient is verified to match jar.owner
    #[account(
        mut,
        constraint = recipient.key() == jar.owner @ TipJarError::InvalidRecipient
    )]
    pub recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct TipJarAccount {
    pub owner: Pubkey,                 // 32
    pub name: String,                  // 4 + 32 = 36
    pub total_tips: u64,               // 8
    pub total_volume_lamports: u64,    // 8
    pub bump: u8,                      // 1
}

impl TipJarAccount {
    pub const SPACE: usize = 8 + 32 + (4 + MAX_JAR_NAME_LEN) + 8 + 8 + 1;
}

#[event]
pub struct TipReceivedEvent {
    pub jar: Pubkey,
    pub tipper: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub message: String,
    pub total_tips: u64,
    pub total_volume_lamports: u64,
}

#[error_code]
pub enum TipJarError {
    #[msg("Jar name cannot be empty")]
    EmptyJarName,
    #[msg("Jar name exceeds 32 characters")]
    JarNameTooLong,
    #[msg("Message exceeds 128 characters")]
    MessageTooLong,
    #[msg("Tip amount must be greater than 0 lamports")]
    InvalidTipAmount,
    #[msg("Recipient does not match Jar owner")]
    InvalidRecipient,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
}
