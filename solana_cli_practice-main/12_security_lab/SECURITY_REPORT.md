# 🛡️ Security & Exploit Lab — отчёт об аудите `vulnerable_vault`

| | |
|---|---|
| **Объект** | `programs/vulnerable_vault` (`7XjM99vjBopv1ExKGpjrW3sS9buTB29G6DJiMoHUdsW2`) |
| **Исправленная версия** | `programs/secure_vault` (`6igRCJBV2PQaEkVnLhLfe71tUsWdktA11dcebVKnCSEh`) |
| **Фреймворк** | Anchor 0.30.1, Solana 1.18.26 |
| **Метод** | ручной code review + PoC-эксплойты на локальном валидаторе (`tests/exploit.ts`) |
| **Итог** | 4 уязвимости (3 Critical, 1 High): все 4 проэксплуатированы на уязвимой версии и заблокированы в исправленной |

## Описание системы

Общее SOL-хранилище (`Vault` PDA `[b"vault"]`). У каждого пользователя есть свой `UserLedger` PDA `[b"ledger", owner]` с внутренним балансом. Инструкции:

- `deposit`: перевод SOL в хранилище, с увеличением баланса в ledger.
- `withdraw`: вывод SOL, с уменьшением баланса.
- `transfer_credit`: перевод внутреннего баланса другому пользователю.
- `emergency_withdraw`: аварийный вывод, только для админа из `Config` PDA `[b"config"]`.

**Инвариант безопасности**: SOL из хранилища может вывести только владелец ledger и только в пределах своего баланса. Админ может вывести средства только через `emergency_withdraw`.

## Матрица атак (воспроизводится через `anchor test`)

| # | Уязвимость | Severity | `vulnerable_vault` | `secure_vault` |
|---|---|---|---|---|
| 1 | Missing signer check | Critical | ❌ украдено 0.5 SOL | ✅ `AccountNotSigner` (3010) |
| 2 | Missing ownership check | Critical | ❌ украдено 0.5 SOL | ✅ `ConstraintSeeds` (2006) |
| 3 | Integer underflow | Critical | ❌ украдено 0.4 SOL, баланс атакующего = 2⁶⁴ − 4·10⁸ | ✅ `InsufficientBalance` |
| 4 | Type cosplay | High | ❌ украдено 0.5 SOL | ✅ `AccountDiscriminatorMismatch` (3002) |

Фактические значения пишутся тестом в `results.json`.

---

## VULN-1: Missing signer check (`withdraw`)

**Код:**
```rust
#[account(mut, seeds = [b"ledger", authority.key().as_ref()], bump = ledger.bump)]
pub ledger: Account<'info, UserLedger>,
/// CHECK: ...
pub authority: UncheckedAccount<'info>,   // ← никто не проверяет is_signer
```
PDA ledger корректно выводится из `authority`, поэтому код *выглядит* безопасным. Но то, что `authority` — это публичный ключ, ещё не значит, что его владелец подписал транзакцию.

**Эксплойт:**
1. Атакующий собирает инструкцию `withdraw(0.5 SOL)` с `authority = victim`, `ledger = PDA(victim)` и `destination = attacker`.
2. Флаг `isSigner` у ключа жертвы равен `false`, а транзакцию подписывает только атакующий (как fee payer).
3. Программа списывает баланс жертвы и переводит SOL атакующему.

**Импакт:** любой может вывести средства любого пользователя.

**Исправление:** `pub authority: Signer<'info>`. Anchor вызывает `AccountNotSigner`, если у аккаунта нет `is_signer`. Дополнительно стоит `constraint = ledger.owner == authority.key()` для защиты в глубину.

---

## VULN-2: Missing ownership check (`transfer_credit`)

**Код:**
```rust
#[account(mut)]
pub from_ledger: Account<'info, UserLedger>,   // ← любой ledger, не связанный с подписантом
pub owner: Signer<'info>,
```
`Account<UserLedger>` проверяет owner-программу и дискриминатор. Но он не проверяет, что ledger **принадлежит подписанту**. Подпись есть, только не та, которая нужна.

**Эксплойт:**
1. Атакующий подписывает `transfer_credit(0.5 SOL)` с `from_ledger = PDA(victim)` и `to_ledger = PDA(attacker)`.
2. Затем выводит «свой» баланс обычным `withdraw`.

**Импакт:** кража внутренних балансов любого пользователя.

**Исправление:**
```rust
#[account(mut, seeds = [b"ledger", owner.key().as_ref()], bump = from_ledger.bump, has_one = owner)]
pub from_ledger: Account<'info, UserLedger>,
```
Seeds гарантируют, что передан именно PDA подписанта (`ConstraintSeeds`), а `has_one` проверяет поле `owner` внутри данных (`ConstraintHasOne`).

---

## VULN-3: Integer underflow (`withdraw`)

**Код:**
```rust
ledger.balance = ledger.balance.wrapping_sub(amount);   // ← нет проверки balance >= amount
```
В release-профиле с `overflow-checks = true` обычный `-` вызвал бы panic. `wrapping_sub` явно отключает эту защиту, а проверки бизнес-условия нет вообще. Тот же класс ошибки возникает при `overflow-checks = false` или при использовании `as`-кастов.

**Эксплойт:** атакующий с нулевым балансом вызывает `withdraw(0.4 SOL)`:
- `0 − 4·10⁸` превращается в `18446744073309551616`,
- 0.4 SOL уходит атакующему,
- а ledger показывает «бесконечный» баланс для будущих выводов.

**Импакт:** вывод чужих средств из общего хранилища, разрушение учёта.

**Исправление:**
```rust
require!(ledger.balance >= amount, VaultError::InsufficientBalance);
ledger.balance = ledger.balance.checked_sub(amount).ok_or(VaultError::InsufficientBalance)?;
```

---

## VULN-4: Type cosplay / account confusion (`emergency_withdraw`)

**Код:**
```rust
pub config: UncheckedAccount<'info>,
...
require_keys_eq!(*info.owner, crate::ID, VaultError::Unauthorized);       // owner проверен
let config = <Config as AnchorDeserialize>::deserialize(&mut &data[8..])?; // дискриминатор — нет!
require_keys_eq!(config.admin, ctx.accounts.admin.key(), ...);
```
Структуры `Config { admin: Pubkey, .. }` и `UserLedger { owner: Pubkey, .. }` начинаются одинаково. Обе принадлежат программе, поэтому проверка owner проходит. Дискриминатор (первые 8 байт) пропускается, поэтому программа не различает типы.

**Эксплойт:** атакующий передаёт **свой** `UserLedger` в качестве `config`. Поле `owner` читается как `admin`, а оно совпадает с подписантом. Дальше `emergency_withdraw(0.5 SOL)` выполняется от имени «админа».

**Импакт:** обход административного контроля и вывод средств хранилища.

**Исправление:**
```rust
#[account(seeds = [b"config"], bump = config.bump, has_one = admin @ VaultError::Unauthorized)]
pub config: Account<'info, Config>,
```
`Account<Config>` проверяет owner и **дискриминатор** (`AccountDiscriminatorMismatch`). Seeds привязывают аккаунт к единственному настоящему config PDA, а `has_one` связывает подписанта с полем `admin`.

---

## Чек-лист для ревью Solana-программ (вывод из лабораторной)

1. Каждый аккаунт, от имени которого совершается действие, должен быть `Signer`.
2. Каждый аккаунт с пользовательскими данными нужно привязать к подписанту через `seeds` и/или `has_one`.
3. Не использовать `UncheckedAccount`/`AccountInfo` + ручную десериализацию там, где подходит `Account<T>`.
4. Вся арифметика над балансами — `checked_*` плюс явные бизнес-проверки (`require!`). Никаких `wrapping_*` и `as`.
5. Для PDA хранить канонический `bump` и проверять `seeds` при каждом использовании.
6. При CPI проверять адрес вызываемой программы (`Program<'info, T>`), чтобы не было arbitrary CPI.
7. Писать негативные тесты: каждая проверка доступа должна иметь тест, который её «ломает».

## Как воспроизвести

```bash
source ../tools/env.sh
anchor build
anchor test --skip-build     # 9 тестов: 4 атаки × 2 программы + легитимный сценарий
diff programs/vulnerable_vault/src/lib.rs programs/secure_vault/src/lib.rs
```

**Источники:**
- Coral/Anchor *sealevel-attacks* (classes: signer authorization, account data matching, owner checks, type cosplay, arithmetic).
- Курс Solana Superteams, модуль Security.
