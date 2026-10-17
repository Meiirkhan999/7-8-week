use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use thiserror::Error;

/// Custom Program Errors
#[derive(Error, Debug, Copy, Clone)]
pub enum NativeProgramError {
    #[error("Invalid Instruction")]
    InvalidInstruction,
    #[error("Not Rent Exempt")]
    NotRentExempt,
    #[error("Account Already Initialized")]
    AlreadyInitialized,
    #[error("Account Uninitialized")]
    Uninitialized,
    #[error("Unauthorized Signer")]
    Unauthorized,
    #[error("Arithmetic Overflow")]
    Overflow,
}

impl From<NativeProgramError> for ProgramError {
    fn from(e: NativeProgramError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

/// State stored in the target account
#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq, Eq)]
pub struct CounterState {
    pub is_initialized: bool,
    pub authority: Pubkey,
    pub count: u64,
}

impl CounterState {
    pub const LEN: usize = 1 + 32 + 8;
}

/// Instructions supported by the native program
#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq, Eq)]
pub enum CounterInstruction {
    /// Initialize a new counter account
    /// Accounts expected:
    /// 0. `[writable]` The counter account to initialize
    /// 1. `[signer]` The authority/owner of the counter
    Initialize { initial_value: u64 },

    /// Increment the counter
    /// Accounts expected:
    /// 0. `[writable]` The counter account
    /// 1. `[signer]` The authority
    Increment { step: u64 },

    /// Reset the counter back to 0
    /// Accounts expected:
    /// 0. `[writable]` The counter account
    /// 1. `[signer]` The authority
    Reset,
}

// Program Entrypoint
#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    msg!("============================================================");
    msg!("Native Program Entrypoint: program_id = {}", program_id);
    msg!("Received instruction_data length = {} bytes", instruction_data.len());

    let instruction = CounterInstruction::try_from_slice(instruction_data)
        .map_err(|_| {
            msg!("Error: Failed to deserialize instruction data via Borsh");
            ProgramError::InvalidInstructionData
        })?;

    let account_info_iter = &mut accounts.iter();

    match instruction {
        CounterInstruction::Initialize { initial_value } => {
            msg!("Instruction: Initialize with initial_value = {}", initial_value);
            let counter_account = next_account_info(account_info_iter)?;
            let authority_account = next_account_info(account_info_iter)?;

            // 1. Validate authority is signer
            if !authority_account.is_signer {
                msg!("Error: Authority must sign to initialize counter");
                return Err(ProgramError::MissingRequiredSignature);
            }

            // 2. Validate counter account ownership
            if counter_account.owner != program_id {
                msg!("Error: Counter account must be owned by program_id {}", program_id);
                return Err(ProgramError::IncorrectProgramId);
            }

            // 3. Deserialize existing data and ensure uninitialized
            let mut state_data = counter_account.try_borrow_mut_data()?;
            if state_data.len() < CounterState::LEN {
                msg!("Error: Account data buffer is too small (got {}, required {})", state_data.len(), CounterState::LEN);
                return Err(ProgramError::AccountDataTooSmall);
            }

            if state_data[0] != 0 {
                msg!("Error: Account is already initialized");
                return Err(NativeProgramError::AlreadyInitialized.into());
            }

            let new_state = CounterState {
                is_initialized: true,
                authority: *authority_account.key,
                count: initial_value,
            };

            new_state.serialize(&mut &mut state_data[..])?;
            msg!("✓ Counter successfully initialized. Authority: {}, Initial Count: {}", authority_account.key, initial_value);
            Ok(())
        }

        CounterInstruction::Increment { step } => {
            msg!("Instruction: Increment by step = {}", step);
            let counter_account = next_account_info(account_info_iter)?;
            let authority_account = next_account_info(account_info_iter)?;

            if !authority_account.is_signer {
                msg!("Error: Authority must sign transaction");
                return Err(ProgramError::MissingRequiredSignature);
            }

            if counter_account.owner != program_id {
                msg!("Error: Counter account must be owned by program_id");
                return Err(ProgramError::IncorrectProgramId);
            }

            let mut state_data = counter_account.try_borrow_mut_data()?;
            let mut state = CounterState::try_from_slice(&state_data)?;

            if !state.is_initialized {
                msg!("Error: Counter account is uninitialized");
                return Err(NativeProgramError::Uninitialized.into());
            }

            if state.authority != *authority_account.key {
                msg!("Error: Authority mismatch. Expected {}, got {}", state.authority, authority_account.key);
                return Err(NativeProgramError::Unauthorized.into());
            }

            state.count = state
                .count
                .checked_add(step)
                .ok_or_else(|| {
                    msg!("Error: Arithmetic overflow during increment");
                    NativeProgramError::Overflow
                })?;

            state.serialize(&mut &mut state_data[..])?;
            msg!("✓ Counter incremented! New count = {}", state.count);
            Ok(())
        }

        CounterInstruction::Reset => {
            msg!("Instruction: Reset Counter");
            let counter_account = next_account_info(account_info_iter)?;
            let authority_account = next_account_info(account_info_iter)?;

            if !authority_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }

            if counter_account.owner != program_id {
                return Err(ProgramError::IncorrectProgramId);
            }

            let mut state_data = counter_account.try_borrow_mut_data()?;
            let mut state = CounterState::try_from_slice(&state_data)?;

            if state.authority != *authority_account.key {
                return Err(NativeProgramError::Unauthorized.into());
            }

            state.count = 0;
            state.serialize(&mut &mut state_data[..])?;
            msg!("✓ Counter reset to 0");
            Ok(())
        }
    }
}
