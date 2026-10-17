use borsh::{BorshDeserialize, BorshSerialize};
use thiserror::Error;

/// Error types for user state operations
#[derive(Error, Debug, PartialEq, Eq)]
pub enum CustomError {
    #[error("Account is already initialized")]
    AlreadyInitialized,

    #[error("Account is not initialized")]
    NotInitialized,

    #[error("Insufficient funds: available {available} lamports, requested {requested} lamports")]
    InsufficientFunds { available: u64, requested: u64 },

    #[error("Account is frozen and cannot execute transactions")]
    AccountFrozen,

    #[error("Username length {len} exceeds maximum allowed length of {max}")]
    UsernameTooLong { len: usize, max: usize },

    #[error("Username cannot be empty")]
    EmptyUsername,

    #[error("Unauthorized action: requires {required:?} role, caller has {caller:?}")]
    Unauthorized { required: Role, caller: Role },

    #[error("Arithmetic overflow occurred")]
    ArithmeticOverflow,

    #[error("Serialization failed: {0}")]
    SerializationError(String),

    #[error("Deserialization failed: {0}")]
    DeserializationError(String),
}

/// User roles in the system
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    StandardUser,
    Operator,
    Validator,
    Admin,
}

/// Lifecycle status of the user account
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountStatus {
    Active,
    Frozen,
    Suspended,
}

/// On-chain simulated User State demonstrating Solana binary data layout
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq)]
pub struct UserState {
    pub is_initialized: bool,
    pub authority: [u8; 32],
    pub username: String,
    pub balance_lamports: u64,
    pub role: Role,
    pub status: AccountStatus,
    pub reward_points: u32,
    pub last_interaction_slot: u64,
}

const MAX_USERNAME_LEN: usize = 32;

impl UserState {
    /// Initialize a new user state with invariant checks
    pub fn new(authority: [u8; 32], username: String, initial_deposit: u64, role: Role) -> Result<Self, CustomError> {
        if username.trim().is_empty() {
            return Err(CustomError::EmptyUsername);
        }
        if username.len() > MAX_USERNAME_LEN {
            return Err(CustomError::UsernameTooLong {
                len: username.len(),
                max: MAX_USERNAME_LEN,
            });
        }

        Ok(Self {
            is_initialized: true,
            authority,
            username,
            balance_lamports: initial_deposit,
            role,
            status: AccountStatus::Active,
            reward_points: 0,
            last_interaction_slot: 1,
        })
    }

    /// Deposit funds and earn reward points
    pub fn deposit(&mut self, amount: u64, current_slot: u64) -> Result<(), CustomError> {
        self.ensure_active()?;

        self.balance_lamports = self
            .balance_lamports
            .checked_add(amount)
            .ok_or(CustomError::ArithmeticOverflow)?;

        // Award 1 reward point per 1,000,000 lamports (0.001 SOL)
        let points_earned = (amount / 1_000_000) as u32;
        self.reward_points = self
            .reward_points
            .checked_add(points_earned)
            .ok_or(CustomError::ArithmeticOverflow)?;

        self.last_interaction_slot = current_slot;
        Ok(())
    }

    /// Withdraw funds with invariant and balance validation
    pub fn withdraw(&mut self, amount: u64, current_slot: u64) -> Result<(), CustomError> {
        self.ensure_active()?;

        if self.balance_lamports < amount {
            return Err(CustomError::InsufficientFunds {
                available: self.balance_lamports,
                requested: amount,
            });
        }

        self.balance_lamports = self
            .balance_lamports
            .checked_sub(amount)
            .ok_or(CustomError::ArithmeticOverflow)?;

        self.last_interaction_slot = current_slot;
        Ok(())
    }

    /// Update role guarded by caller role check
    pub fn update_role(&mut self, new_role: Role, caller_role: Role) -> Result<(), CustomError> {
        self.ensure_active()?;

        if caller_role != Role::Admin {
            return Err(CustomError::Unauthorized {
                required: Role::Admin,
                caller: caller_role,
            });
        }

        self.role = new_role;
        Ok(())
    }

    /// Freeze account (e.g. for compliance or security)
    pub fn freeze(&mut self, caller_role: Role) -> Result<(), CustomError> {
        if caller_role != Role::Admin && caller_role != Role::Operator {
            return Err(CustomError::Unauthorized {
                required: Role::Operator,
                caller: caller_role,
            });
        }
        self.status = AccountStatus::Frozen;
        Ok(())
    }

    /// Unfreeze account
    pub fn unfreeze(&mut self, caller_role: Role) -> Result<(), CustomError> {
        if caller_role != Role::Admin {
            return Err(CustomError::Unauthorized {
                required: Role::Admin,
                caller: caller_role,
            });
        }
        self.status = AccountStatus::Active;
        Ok(())
    }

    /// Helper to ensure state is active
    fn ensure_active(&self) -> Result<(), CustomError> {
        if !self.is_initialized {
            return Err(CustomError::NotInitialized);
        }
        if self.status == AccountStatus::Frozen {
            return Err(CustomError::AccountFrozen);
        }
        Ok(())
    }

    /// Binary serialization using Borsh
    pub fn to_bytes(&self) -> Result<Vec<u8>, CustomError> {
        borsh::to_vec(self).map_err(|e| CustomError::SerializationError(e.to_string()))
    }

    /// Binary deserialization from raw byte slice
    pub fn from_bytes(data: &[u8]) -> Result<Self, CustomError> {
        borsh::from_slice(data).map_err(|e| CustomError::DeserializationError(e.to_string()))
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("============================================================");
    println!("  MODULE 3: Rust for Solana - CLI State & Borsh Serialization");
    println!("============================================================");

    // 1. Initialize State
    let mock_authority = [7u8; 32];
    println!("[1] Creating new UserState...");
    let mut user = UserState::new(
        mock_authority,
        "AliceDev".to_string(),
        5_000_000_000, // 5 SOL
        Role::StandardUser,
    )?;
    println!("    Initialized: {:?}", user);

    // 2. Modify State: Deposit
    println!("\n[2] Depositing 2.5 SOL (2,500,000,000 lamports) at slot 100...");
    user.deposit(2_500_000_000, 100)?;
    println!("    New Balance: {} lamports ({} SOL)", user.balance_lamports, user.balance_lamports as f64 / 1e9);
    println!("    Reward Points: {}", user.reward_points);
    assert_eq!(user.balance_lamports, 7_500_000_000);
    assert_eq!(user.reward_points, 2500);

    // 3. Borsh Binary Serialization
    println!("\n[3] Serializing UserState to Borsh binary format...");
    let serialized_bytes = user.to_bytes()?;
    println!("    Serialized byte size: {} bytes", serialized_bytes.len());
    println!("    Raw hex payload: {:02x?}", &serialized_bytes[..usize::min(serialized_bytes.len(), 48)]);

    // 4. Borsh Binary Deserialization
    println!("\n[4] Deserializing raw bytes back to UserState struct...");
    let deserialized_user = UserState::from_bytes(&serialized_bytes)?;
    println!("    Deserialized struct: {:?}", deserialized_user);
    assert_eq!(user, deserialized_user, "Invariant check: Deserialized object must match original");
    println!("    ✓ Invariant verified: user == deserialized_user");

    // 5. State Modification: Withdrawal
    println!("\n[5] Withdrawing 1 SOL (1,000,000,000 lamports) at slot 250...");
    user.withdraw(1_000_000_000, 250)?;
    println!("    Updated Balance: {} lamports ({} SOL)", user.balance_lamports, user.balance_lamports as f64 / 1e9);
    assert_eq!(user.balance_lamports, 6_500_000_000);

    // 6. Test Error Handling: Insufficient Funds
    println!("\n[6] Testing edge-case: Attempting to withdraw 10 SOL (exceeds balance)...");
    match user.withdraw(10_000_000_000, 300) {
        Err(CustomError::InsufficientFunds { available, requested }) => {
            println!("    ✓ Successfully caught expected error: InsufficientFunds(available={}, requested={})", available, requested);
        }
        other => panic!("Expected InsufficientFunds error, got {:?}", other),
    }

    // 7. Role Management & Authorization
    println!("\n[7] Testing Role Management & Access Control...");
    // Unauthorized upgrade attempt
    match user.update_role(Role::Validator, Role::StandardUser) {
        Err(CustomError::Unauthorized { required, caller }) => {
            println!("    ✓ Unauthorized role update blocked: Required {:?}, Caller {:?}", required, caller);
        }
        other => panic!("Expected Unauthorized error, got {:?}", other),
    }
    // Authorized upgrade
    user.update_role(Role::Validator, Role::Admin)?;
    println!("    ✓ Successfully promoted user role to: {:?}", user.role);
    assert_eq!(user.role, Role::Validator);

    // 8. Freeze & Unfreeze flow
    println!("\n[8] Testing Account Freeze flow...");
    user.freeze(Role::Operator)?;
    println!("    Account status after freeze: {:?}", user.status);
    match user.deposit(1_000_000, 400) {
        Err(CustomError::AccountFrozen) => {
            println!("    ✓ Action blocked while frozen: CustomError::AccountFrozen");
        }
        other => panic!("Expected AccountFrozen error, got {:?}", other),
    }
    user.unfreeze(Role::Admin)?;
    println!("    Account unfrozen: {:?}", user.status);

    // Write results JSON
    let result_json = format!(
        "{{\n  \"module\": \"03_rust_cli_practice\",\n  \"status\": \"SUCCESS\",\n  \"serialized_bytes_len\": {},\n  \"final_balance_lamports\": {},\n  \"final_reward_points\": {},\n  \"role\": \"{:?}\"\n}}",
        serialized_bytes.len(),
        user.balance_lamports,
        user.reward_points,
        user.role
    );
    std::fs::write("results.json", result_json)?;
    println!("\n✓ Results written to results.json");
    println!("✓ MODULE 3 EXECUTION COMPLETE: ALL INVARIANTS AND SERIALIZATION TESTS PASSED!\n");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialization_and_serialization() {
        let auth = [42u8; 32];
        let user = UserState::new(auth, "Bob".to_string(), 100_000, Role::StandardUser).unwrap();
        let bytes = user.to_bytes().unwrap();
        let recovered = UserState::from_bytes(&bytes).unwrap();
        assert_eq!(user, recovered);
    }

    #[test]
    fn test_username_length_validation() {
        let auth = [1u8; 32];
        let err = UserState::new(auth, "".to_string(), 100, Role::StandardUser).unwrap_err();
        assert_eq!(err, CustomError::EmptyUsername);

        let long_name = "a".repeat(33);
        let err = UserState::new(auth, long_name, 100, Role::StandardUser).unwrap_err();
        assert!(matches!(err, CustomError::UsernameTooLong { .. }));
    }

    #[test]
    fn test_insufficient_funds() {
        let mut user = UserState::new([2u8; 32], "Charlie".to_string(), 500, Role::StandardUser).unwrap();
        let err = user.withdraw(1000, 10).unwrap_err();
        assert_eq!(err, CustomError::InsufficientFunds { available: 500, requested: 1000 });
    }
}
