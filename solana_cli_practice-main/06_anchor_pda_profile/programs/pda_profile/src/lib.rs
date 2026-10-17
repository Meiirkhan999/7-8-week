use anchor_lang::prelude::*;

declare_id!("jDKFxcSNbSRbQvUmLHq28jh1GzYfbaoZT31YWpssfuA");

pub const MAX_USERNAME_LEN: usize = 32;
pub const MAX_BIO_LEN: usize = 128;
pub const MAX_AVATAR_URL_LEN: usize = 64;

#[program]
pub mod pda_profile {
    use super::*;

    pub fn create_profile(
        ctx: Context<CreateProfile>,
        username: String,
        bio: String,
        avatar_url: String,
    ) -> Result<()> {
        require!(!username.trim().is_empty(), ProfileError::EmptyUsername);
        require!(username.len() <= MAX_USERNAME_LEN, ProfileError::UsernameTooLong);
        require!(bio.len() <= MAX_BIO_LEN, ProfileError::BioTooLong);
        require!(avatar_url.len() <= MAX_AVATAR_URL_LEN, ProfileError::AvatarUrlTooLong);

        let profile = &mut ctx.accounts.profile;
        profile.authority = ctx.accounts.authority.key();
        profile.username = username;
        profile.bio = bio;
        profile.avatar_url = avatar_url;
        profile.points = 100; // Welcome points
        profile.bump = ctx.bumps.profile;

        msg!(
            "Profile created for {} with PDA bump {}",
            profile.authority,
            profile.bump
        );
        Ok(())
    }

    pub fn update_profile(
        ctx: Context<UpdateProfile>,
        bio: Option<String>,
        avatar_url: Option<String>,
    ) -> Result<()> {
        let profile = &mut ctx.accounts.profile;

        if let Some(new_bio) = bio {
            require!(new_bio.len() <= MAX_BIO_LEN, ProfileError::BioTooLong);
            profile.bio = new_bio;
        }

        if let Some(new_avatar) = avatar_url {
            require!(new_avatar.len() <= MAX_AVATAR_URL_LEN, ProfileError::AvatarUrlTooLong);
            profile.avatar_url = new_avatar;
        }

        msg!("Profile updated for authority {}", profile.authority);
        Ok(())
    }

    pub fn add_reputation_points(ctx: Context<AddReputation>, points: u64) -> Result<()> {
        let profile = &mut ctx.accounts.profile;
        profile.points = profile
            .points
            .checked_add(points)
            .ok_or(ProfileError::ArithmeticOverflow)?;
        msg!("Added {} points to {}. Total: {}", points, profile.username, profile.points);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateProfile<'info> {
    #[account(
        init,
        payer = authority,
        space = UserProfile::SPACE,
        seeds = [b"user_profile", authority.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, UserProfile>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    #[account(
        mut,
        seeds = [b"user_profile", authority.key().as_ref()],
        bump = profile.bump,
        has_one = authority @ ProfileError::Unauthorized
    )]
    pub profile: Account<'info, UserProfile>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AddReputation<'info> {
    #[account(
        mut,
        seeds = [b"user_profile", profile.authority.as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, UserProfile>,

    pub authority: Signer<'info>,
}

#[account]
pub struct UserProfile {
    pub authority: Pubkey,   // 32
    pub username: String,    // 4 + 32 = 36
    pub bio: String,         // 4 + 128 = 132
    pub avatar_url: String,  // 4 + 64 = 68
    pub points: u64,         // 8
    pub bump: u8,            // 1
}

impl UserProfile {
    // 8 (discriminator) + 32 (pubkey) + (4 + 32) + (4 + 128) + (4 + 64) + 8 (points) + 1 (bump)
    pub const SPACE: usize = 8 + 32 + (4 + MAX_USERNAME_LEN) + (4 + MAX_BIO_LEN) + (4 + MAX_AVATAR_URL_LEN) + 8 + 1;
}

#[error_code]
pub enum ProfileError {
    #[msg("Username cannot be empty")]
    EmptyUsername,
    #[msg("Username exceeds max allowed length of 32 characters")]
    UsernameTooLong,
    #[msg("Bio exceeds max allowed length of 128 characters")]
    BioTooLong,
    #[msg("Avatar URL exceeds max allowed length of 64 characters")]
    AvatarUrlTooLong,
    #[msg("Unauthorized: Signer does not own this profile")]
    Unauthorized,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
}
