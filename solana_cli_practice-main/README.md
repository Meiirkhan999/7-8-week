# 🚀 Solana Developer Track (Модули 1 — 16)

Полнофункциональный сквозной репозиторий практических работ по разработке смарт-контрактов и приложений на блокчейне Solana — от первой транзакции и разбора реальных транзакций mainnet, через Rust, нативные программы, Anchor, PDA и Token-2022, к DeFi-интеграциям (Pyth, Jupiter), CPI-композиции, лаборатории эксплойтов, регулируемому стейблкоину с Solana Pay и финальному продукту **Creator Pay** (Capstone).

---

## 📑 Содержание
1. [Обзор и архитектурный стек](#-обзор-и-архитектурный-стек)
2. [Структура репозитория](#-структура-репозитория)
3. [Подробный разбор модулей (01 — 16)](#-подробный-разбор-модулей)
   - [Модуль 1: Первая транзакция в Solana](#модуль-1-вход-в-web3-первая-транзакция)
   - [Модуль 2: Transaction Detective](#модуль-2-transaction-detective)
   - [Модуль 3: Rust CLI & Borsh Serialization](#модуль-3-rust-для-solana-cli-application)
   - [Модуль 4: First Native Solana Program (No Anchor)](#модуль-4-первая-нативная-программа-solana)
   - [Модуль 5: Anchor Framework (Counter Program)](#модуль-5-фреймворк-anchor-счетчик)
   - [Модуль 6: Accounts & PDAs (On-chain Profile)](#модуль-6-аккаунты-и-pda-децентрализованный-профиль)
   - [Модуль 7: SPL Tokens & Token-2022 Extensions](#модуль-7-spl-токены-и-расширения-token-2022)
   - [Модуль 8: PK1 Build Sprint (MVP Decentralized Tip Jar)](#модуль-8-pk1-build-sprint-mvp-decentralized-tip-jar)
   - [Модуль 9: DeFi на Solana (Pyth + Jupiter)](#модуль-9-defi-на-solana-pyth--jupiter)
   - [Модуль 10: RPC, API и дашборд](#модуль-10-rpc-api-и-blockchain-dashboard)
   - [Модуль 11: CPI и composable-приложения](#модуль-11-cpi-и-composable-приложения)
   - [Модуль 12: Security & Exploit Lab](#модуль-12-security--exploit-lab)
   - [Модуль 13: RWA, стейблкоины и платежи](#модуль-13-rwa-стейблкоины-и-платежи)
   - [Модуль 14: Capstone — Creator Pay](#модуль-14-capstone--creator-pay)
   - [Модули 15–16: Demo Day и защита](#модули-1516-demo-day-и-защита)
4. [Требования и подготовка окружения](#-требования-и-подготовка-окружения)
5. [Инструкция по сборке и запуску тестов](#-инструкция-по-сборке-и-запуску-тестов)
6. [Сводная таблица результатов верификации](#-сводная-таблица-результатов-верификации)
7. [Решенные инженерные нюансы и Troubleshooting](#-решенные-инженерные-нюансы-и-troubleshooting)

---

## 🧭 Обзор и архитектурный стек

Проект охватывает полный спектр системной инженерии на Solana:
- **Языки программирования**: Rust (2021 edition), TypeScript (Node.js / tsx / ts-mocha).
- **Фреймворки и SDK**: 
  - `solana-program` (v1.18) — базовый низкоуровневый SDK для нативных программ.
  - `@coral-xyz/anchor` (v0.30.1) & `anchor-lang` — высокоуровневый декларативный eDSL фреймворк.
  - `@solana/web3.js` (v1.95) & `@solana/spl-token` (v0.4) — клиентские библиотеки взаимодействия с RPC.
- **Целевая среда выполнения**: Solana Bytecode Format (`sbfv1` / eBPF).
- **Схема сериализации данных**: Borsh (Binary Structured Serialization for Cross-Language Objects).
- **Стандарты токенов**: Classic SPL Token Program + Token-2022 (TransferFee, MetadataPointer/TokenMetadata, DefaultAccountState, PermanentDelegate).
- **DeFi и данные**: оракул Pyth (on-chain `PriceUpdateV2`), агрегатор Jupiter (quote API), Solana Pay (transfer requests).
- **Фронтенд**: Vite + React 18, `@solana/wallet-adapter` (Wallet Standard + Burner для localnet).
- **Тесты**: `anchor test` (ts-mocha), `cargo test`, `node:test`, `vitest`.

---

## 📂 Структура репозитория

```text
solana_cli_practice/
├── 01_first_transaction/       # Модуль 1: кошелёк, devnet SOL, первая транзакция + разбор для Explorer
│   ├── scripts/first_tx.ts
│   ├── TX_BREAKDOWN.md         # генерируется скриптом
│   └── results.json
├── 02_transaction_detective/   # Модуль 2: декодер реальных транзакций mainnet (accounts/instructions/programs)
│   ├── src/decode.ts
│   ├── scripts/detective.ts
│   ├── fixtures/ reports/      # реальные транзакции (JSON) и отчёты (Markdown)
│   └── tests/decode.test.ts
├── 03_rust_cli_practice/       # Модуль 3: CLI на Rust с Borsh-сериализацией и ролевой моделью
│   ├── Cargo.toml
│   ├── results.json
│   └── src/main.rs
├── 04_native_program/          # Модуль 4: Нативная программа Solana без Anchor (entrypoint!)
│   ├── Cargo.toml
│   ├── deployment.log
│   ├── results.json
│   ├── src/lib.rs
│   └── target/deploy/native_program.so
├── 05_anchor_counter/          # Модуль 5: Программа-счетчик на фреймворке Anchor
│   ├── Anchor.toml
│   ├── results.json
│   ├── programs/counter/src/lib.rs
│   ├── target/idl/counter.json
│   └── tests/counter.ts
├── 06_anchor_pda_profile/      # Модуль 6: Реестр пользовательских профилей на PDA
│   ├── Anchor.toml
│   ├── results.json
│   ├── programs/pda_profile/src/lib.rs
│   ├── target/idl/pda_profile.json
│   └── tests/pda_profile.ts
├── 07_spl_tokens/              # Модуль 7: Пайплайн выпуска SPL токенов и Token-2022 с комиссией
│   ├── package.json
│   ├── results.json
│   └── scripts/token_flow.ts
├── 08_mvp_tip_jar/             # Модуль 8: DeFi MVP "Донат-банка" с Native CPI и Anchor Events
│   ├── Anchor.toml
│   ├── README.md
│   ├── results.json
│   ├── programs/tip_jar/src/lib.rs
│   ├── target/idl/tip_jar.json
│   └── tests/tip_jar.ts
├── 09_defi_integration/        # Модуль 9: Pyth (on-chain) + Jupiter → чаевые в USD через tip_jar
│   ├── PROTOCOLS.md
│   ├── src/defi.ts
│   └── scripts/{prices,tip_usd}.ts
├── 10_blockchain_dashboard/    # Модуль 10: React-дашборд (балансы, токены, tx, активность программ, события)
│   ├── src/lib/{solana,events}.ts
│   └── scripts/snapshot.ts
├── 11_cpi_composable/          # Модуль 11: tip_rewards — CPI в tip_jar + System + ATA + SPL Token
│   └── programs/tip_rewards/src/lib.rs
├── 12_security_lab/            # Модуль 12: vulnerable_vault vs secure_vault + эксплойты
│   ├── SECURITY_REPORT.md
│   └── tests/exploit.ts
├── 13_rwa_payments/            # Модуль 13: дизайн продукта + Token-2022 tUSD (KYC) + Solana Pay инвойсы
│   ├── PRODUCT_DESIGN.md
│   ├── src/solana_pay.ts
│   └── scripts/stablecoin.ts
├── 14_capstone_creator_pay/    # Модуль 14: Capstone — программа creator_pay + веб-приложение
│   ├── programs/creator_pay/src/lib.rs
│   ├── tests/creator_pay.ts
│   ├── scripts/{client,seed_demo,faucet}.ts
│   ├── docs/ARCHITECTURE.md
│   └── app/                    # Vite + React + wallet-adapter
├── 15_demo_day/                # Модуль 15: PITCH.md, DEMO_SCRIPT.md, demo.sh (одна команда для live demo)
├── 16_defense/                 # Модуль 16: DEFENSE_QA.md — вопросы/ответы, карта РО и весов
├── tools/env.sh                # Окружение для сборки Anchor-модулей (см. Troubleshooting)
├── Cargo.toml                  # Общий родительский манифест (edition = "2021")
└── README.md                   # Главная документация проекта
```

---

## 🔬 Подробный разбор модулей

### Модуль 1: Вход в Web3 (первая транзакция)
- **Путь**: `01_first_transaction`
- **Цель**: создать кошелёк, получить тестовый SOL, отправить первую транзакцию и разобрать её в Solana Explorer.
- **Что делает `scripts/first_tx.ts`**:
  1. Загружает или создаёт кошелёк `~/.config/solana/id.json`.
  2. Пробует получить airdrop.
  3. Отправляет `SystemProgram.transfer` (0.01 SOL) + инструкцию Memo.
  4. Перечитывает транзакцию через `getParsedTransaction` и печатает ссылку на Explorer, slot, fee, compute units, роли аккаунтов (signer/writable), инструкции, логи и изменения балансов.
  5. Генерирует `TX_BREAKDOWN.md` с инструкцией, как читать каждый блок Explorer.
- **Запуск**:
  ```bash
  cd 01_first_transaction && npm install
  npx tsx scripts/first_tx.ts                                   # devnet (нужен SOL с faucet.solana.com)
  SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/first_tx.ts   # локальный валидатор
  ```
- ⚠️ RPC-faucet devnet закрыт (`requestAirdrop` → HTTP 410). Пополните адрес кошелька через https://faucet.solana.com.

---

### Модуль 2: Transaction Detective
- **Путь**: `02_transaction_detective`
- **Цель**: разобрать реальные транзакции Solana — определить accounts, instructions и programs.
- **Ключевые особенности**:
  - `src/decode.ts` — чистый декодер:
    - аккаунты с ролями (fee payer, signer, writable, загружен из Address Lookup Table);
    - top-level и inner (CPI) инструкции с путём `#1.3`;
    - счётчик вызовов программ, изменения SOL/токен-балансов;
    - «вердикт»: DEX swap, SOL transfer, SPL transfer и т.д.
  - Словарь программ: System, Compute Budget, Token, Token-2022, ATA, Memo, Jupiter v6, Raydium, Orca, Meteora, Pump.fun/PumpSwap, Pyth, Marinade, Kamino.
  - Поддерживает legacy, **v0 и v1** сообщения (на mainnet уже встречаются v1-транзакции).
  - Без аргументов берёт свежие живые транзакции Jupiter, Memo и Pump.fun с mainnet. Можно передать свои подписи (`--cluster devnet <sig>` — например, транзакцию из модуля 1).
  - Тесты на реальных фикстурах проверяют инварианты: число аккаунтов и инструкций, сумму вызовов программ, сохранение SOL (Σ Δ = −fee).
- **Запуск**:
  ```bash
  cd 02_transaction_detective && npm install
  npx tsx scripts/detective.ts                 # → reports/<sig>.md, reports/SUMMARY.md, results.json
  npm test                                     # 7 тестов
  ```

---

### Модуль 3: Rust для Solana (CLI Application)
- **Путь**: `03_rust_cli_practice`
- **Цель**: Освоение механик Rust, критически важных для Solana (Zero-copy layout, Borsh сериализация, управление памятью, безопасная арифметика и валидация инвариантов состояния).
- **Ключевые сущности**:
  - `UserState`: структура состояния пользователя (`authority`, `username`, `balance_lamports`, `role`, `status`, `reward_points`).
  - `Role` & `AccountStatus`: перечисления с деривациями `BorshSerialize`, `BorshDeserialize`.
  - Кастомный обработчик ошибок `CustomError` (`thiserror`) с защитой от `InsufficientFunds`, `AccountFrozen`, `Unauthorized`, `ArithmeticOverflow`.
- **Запуск**:
  ```bash
  cd 03_rust_cli_practice
  cargo run
  ```

---

### Модуль 4: Первая нативная программа Solana
- **Путь**: `04_native_program`
- **Цель**: Разработка смарт-контракта без использования высокоуровневых абстракций Anchor.
- **Ключевые особенности**:
  - Точка входа `entrypoint!(process_instruction)` принимающая `(&Pubkey, &[AccountInfo], &[u8])`.
  - Ручная десериализация команд: `Initialize`, `Increment`, `Reset`.
  - Ручной контроль безопасности: проверка флага `is_signer`, валидация владельца аккаунта (`counter_account.owner == program_id`), проверка размера буфера памяти.
  - Логирование через `msg!()`.
  - Сборка под архитектуру `sbfv1` и развертывание с получением Program ID.
- **Запуск сборки и деплоя**:
  ```bash
  cd 04_native_program
  cargo build-sbf --arch sbfv1
  solana program deploy ./target/deploy/native_program.so
  ```

---

### Модуль 5: Фреймворк Anchor (Счетчик)
- **Путь**: `05_anchor_counter`
- **Цель**: Построение надежных смарт-контрактов с автоматической валидацией аккаунтов, 8-байтными дискриминаторами и типизированными клиентами на TypeScript.
- **Инструкции программы**:
  - `initialize(initial_count)`: аллокация аккаунта (`space = 8 + 32 + 8`), сохранение authority.
  - `increment(step)`: безопасное увеличение через `checked_add` с макросом `require_keys_eq!` (проверка подписи владельца).
  - `reset()`: сброс значения в 0 авторизованным владельцем.
- **Тестовый стек**: TypeScript + `@coral-xyz/anchor`, проверка авторизации и перехват `AnchorError::Unauthorized`.
- **Запуск тестов**:
  ```bash
  cd 05_anchor_counter
  anchor test --skip-build
  ```

---

### Модуль 6: Аккаунты и PDA (Децентрализованный профиль)
- **Путь**: `06_anchor_pda_profile`
- **Цель**: Архитектура детерминированных аккаунтов (Program Derived Addresses) без приватных ключей.
- **Ключевые особенности**:
  - Детерминированные сиды: `seeds = [b"user_profile", authority.key().as_ref()]`.
  - Точный расчет памяти: `UserProfile::SPACE = 8 (disc) + 32 (pubkey) + (4 + 32) + (4 + 128) + (4 + 64) + 8 (points) + 1 (bump)`.
  - Защита от коллизий и повторной инициализации: Anchor constraint `init` гарантирует невозможность создания дубликата для одного `authority`.
  - Защита от подмены владельца при обновлении bio/avatarUrl (`has_one = authority`).
- **Запуск тестов**:
  ```bash
  cd 06_anchor_pda_profile
  anchor test --skip-build
  ```

---

### Модуль 7: SPL Токены и расширения Token-2022
- **Путь**: `07_spl_tokens`
- **Цель**: Автоматизированный скрипт жизненного цикла токенов на `@solana/spl-token`.
- **Реализованный пайплайн**:
  1. Создание нового Mint классического токена (Decimals: 6).
  2. Детерминированное создание Associated Token Accounts (ATA) для отправителя и получателя.
  3. Минт эмиссии в 1,000,000 токенов на ATA плательщика.
  4. Перевод 250,000 токенов на ATA получателя с проверкой балансов.
  5. **Token-2022 Extension (Transfer Fee)**: создание токена расширенного стандарта с автоматическим удержанием комиссии за перевод (2.5%, до 5,000 токенов).
- **Запуск пайплайна**:
  ```bash
  cd 07_spl_tokens
  npx tsx scripts/token_flow.ts
  ```

---

### Модуль 8: PK1 Build Sprint (MVP Decentralized Tip Jar)
- **Путь**: `08_mvp_tip_jar`
- **Цель**: Готовый к продакшену MVP протокола донатов (Tip Jar).
- **Архитектура**:
  - `initialize_jar(name)`: создание PDA-банки с сидами `[b"tip_jar", owner, name]`.
  - `tip(amount, message)`: 
    - Прямой перевод SOL от фаната создателю через Native CPI (`anchor_lang::system_program::transfer`).
    - Обновление ончейн-аналитики (счетчик донатов `total_tips`, кумулятивный объем `total_volume_lamports`).
    - Эмит ончейн-события `TipReceivedEvent` для индексации и фронтенд-вебсокетов.
  - **Безопасность**: проверка `constraint = recipient.key() == jar.owner` исключает подмену кошелька получателя.
- **Запуск тестов**:
  ```bash
  cd 08_mvp_tip_jar
  anchor test --skip-build
  ```

---

### Модуль 9: DeFi на Solana (Pyth + Jupiter)
- **Путь**: `09_defi_integration`
- **Цель**: изучить протоколы экосистемы ([`PROTOCOLS.md`](09_defi_integration/PROTOCOLS.md)) и встроить DeFi-функциональность в приложение — чаевые в **долларах** для Tip Jar из модуля 8.
- **Реализация**:
  - Цена SOL/USD берётся **on-chain** из аккаунта Pyth `PriceUpdateV2` (mainnet, read-only). Ручной декодер проверяет feed id, уровень верификации Full, свежесть ≤120 с и confidence ≤1 %.
  - Кросс-проверка с котировкой **Jupiter** SOL→USDC (маршрут по реальным AMM). При расхождении больше 2 % операция отменяется.
  - USD→lamports считается целочисленно, с округлением вниз и потолком проскальзывания 1 %.
  - Затем вызывается `tip_jar.tip` (IDL модуля 8) на локальном валидаторе. Проверяется, что автор получил ровно рассчитанную сумму.
- **Запуск**:
  ```bash
  cd 09_defi_integration && npm install
  npm run validator            # терминал 1: валидатор с tip_jar (нужен собранный 08: anchor build)
  npx tsx scripts/prices.ts    # снимок Pyth vs Jupiter для 1 / 100 / 10 000 SOL
  npx tsx scripts/tip_usd.ts 5 # чаевые $5
  npm test                     # 6 тестов
  ```

---

### Модуль 10: RPC, API и Blockchain Dashboard
- **Путь**: `10_blockchain_dashboard`
- **Цель**: дашборд с балансами, токенами, транзакциями и активностью программ.
- **Реализация (Vite + React)**:
  - Баланс SOL; SPL- и Token-2022-токены (`getParsedTokenAccountsByOwner` по обеим программам); последние транзакции со статусом и ссылками на Explorer.
  - **Активность программы**: столбчатая диаграмма транзакций во времени (SVG, hover-подсказки, табличное представление, светлая и тёмная темы).
  - Декодирование Anchor-событий `TipReceivedEvent` через `EventParser` + IDL.
  - Состояние в URL (`?cluster=&address=&program=`) — ссылкой можно поделиться.
  - `scripts/snapshot.ts` — CLI-двойник: тот же слой данных пишет `results.json`.
- **Запуск**:
  ```bash
  cd 10_blockchain_dashboard && npm install
  npm run dev        # http://localhost:5173/?cluster=localnet&address=<wallet>
  npm test           # 10 тестов
  npm run build
  ```

---

### Модуль 11: CPI и composable-приложения
- **Путь**: `11_cpi_composable`
- **Цель**: программа, взаимодействующая с несколькими существующими программами.
- **Программа `tip_rewards`**: одна инструкция `tip_with_reward` собирает 4 программы:
  1. **CPI в `tip_jar`** (модуль 8, crate-зависимость с `features = ["cpi"]`). Внутри tip_jar делает вложенный CPI в **System Program** (глубина 3).
  2. **Associated Token Program** создаёт RWD-аккаунт фаната (`init_if_needed`).
  3. **SPL Token** `mint_to` с подписью PDA `[b"mint_authority"]` (`invoke_signed`).
- Аккаунт `jar` типизирован как `Account<TipJarAccount>`: фейковый jar чужой программы отклоняется до CPI.
- `Anchor.toml` `[[test.genesis]]` подгружает `tip_jar.so` по его реальному адресу.
- **Тесты (7)**: дерево CPI проверяется по логам `invoke [1..3]`. Проверяются подмена получателя, фейковый jar, dust-чаевые и прямой `mint_to` в обход программы.
  ```bash
  cd 11_cpi_composable && source ../tools/env.sh
  anchor build && anchor test --skip-build
  ```

---

### Модуль 12: Security & Exploit Lab
- **Путь**: `12_security_lab` · отчёт: [`SECURITY_REPORT.md`](12_security_lab/SECURITY_REPORT.md)
- Две программы с одинаковым интерфейсом (SOL-хранилище с ledger'ами пользователей): `vulnerable_vault` и `secure_vault`. Исправления видны через `diff`.

| # | Уязвимость | Эксплойт (vulnerable) | Защита (secure) |
|---|---|---|---|
| 1 | Missing signer | вывод с ledger жертвы без её подписи | `AccountNotSigner` |
| 2 | Missing ownership check | перенос баланса жертвы в свой ledger | `ConstraintSeeds` |
| 3 | Integer underflow (`wrapping_sub`) | вывод с нулевым балансом → баланс 2⁶⁴−… | `InsufficientBalance` |
| 4 | Type cosplay (без дискриминатора) | свой `UserLedger` вместо admin `Config` | `AccountDiscriminatorMismatch` |

  ```bash
  cd 12_security_lab && source ../tools/env.sh
  anchor build && anchor test --skip-build     # 9 тестов, матрица атак → results.json
  ```

---

### Модуль 13: RWA, стейблкоины и платежи
- **Путь**: `13_rwa_payments` · дизайн продукта: [`PRODUCT_DESIGN.md`](13_rwa_payments/PRODUCT_DESIGN.md) — **PayBridge**, кросс-граничные инвойсы в стейблкоине.
- **Прототип `scripts/stablecoin.ts`**:
  - Выпуск Token-2022 **tUSD** с расширениями MetadataPointer + TokenMetadata (эмитент, юрисдикция, аттестация резервов), DefaultAccountState=Frozen (KYC = thaw), PermanentDelegate (clawback).
  - Инвойс как URL **Solana Pay** с уникальным `reference`. Свой encoder/parser по спецификации, потому что `@solana/pay` 1.x построен на web3.js v2.
  - Оплата `transferChecked` + reference + memo.
  - Мерчант находит платёж по reference и валидирует его (статус, mint, получатель, точная сумма).
  - Перевод на не-KYC кошелёк блокируется («Account is frozen»), clawback выполняется через permanent delegate.
  ```bash
  cd 13_rwa_payments && npm install
  solana-test-validator --reset --quiet        # терминал 1
  npx tsx scripts/stablecoin.ts                # терминал 2
  npm test                                     # 5 тестов (включая реальную оплату из фикстуры)
  ```

---

### Модуль 14: Capstone — Creator Pay
- **Путь**: `14_capstone_creator_pay` · архитектура: [`docs/ARCHITECTURE.md`](14_capstone_creator_pay/docs/ARCHITECTURE.md)
- **Продукт**: некастодиальная платформа чаевых для авторов. Фанат платит в SOL (сумма в $ по Pyth, защита от проскальзывания 1 %) или в tUSD (Token-2022, KYC). Деньги идут **напрямую** автору, фанат получает RWD-токены.
- **Программа `creator_pay`** (`Fv3WvmspvcUCd7HJ8Kb2NeNvmTXmuEFvF2qVZqBsRQkV`): `init_platform`, `register_creator` (PDA, 1 кошелёк = 1 страница), `update_profile`, `tip_sol`, `tip_stable` (`token_interface::transfer_checked`), награды через PDA-подпись. Применён весь чек-лист модуля 12.
- **Веб-приложение** (`app/`): список авторов с метриками и графиком активности; страница автора с формой чаевых и лентой событий; создание и редактирование своей страницы; Phantom/Solflare через Wallet Standard и Burner-кошелёк для localnet.
- **Тесты**: 9 интеграционных (`anchor test`) + 3 Rust unit + 7 фронтенд (`vitest`). Сквозной сценарий в браузере проверен: регистрация, чаевые $5 в SOL по курсу Pyth, начисление RWD, обновление ленты.
  ```bash
  cd 14_capstone_creator_pay && npm install && source ../tools/env.sh
  anchor build && anchor test --skip-build
  npm run validator                  # терминал 1
  npm run seed                       # терминал 2: платформа, tUSD, 3 автора, чаевые
  cd app && npm install && npm run dev   # http://localhost:5174
  ```

---

### Модули 15–16: Demo Day и защита
- **`15_demo_day/`**:
  - [`PITCH.md`](15_demo_day/PITCH.md) — 6 слайдов, тайминг, роли;
  - [`DEMO_SCRIPT.md`](15_demo_day/DEMO_SCRIPT.md) — сценарий live demo по секундам + план Б;
  - **`demo.sh`** — одна команда поднимает валидатор, программу, сиды и приложение (`--check` — только preflight).
- **`16_defense/`** — [`DEFENSE_QA.md`](16_defense/DEFENSE_QA.md): карта «неделя → РО → вес → артефакт → команда проверки», вопросы и ответы по каждому модулю, чек-лист перед защитой.
  ```bash
  ./15_demo_day/demo.sh
  ```

---

## ⚙️ Требования и подготовка окружения

1. **Rust & Cargo**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   rustc --version # Рекомендуется 1.75+ / 1.80+
   ```
2. **Solana CLI**:
   ```bash
   sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)"   # release.solana.com больше не обслуживается
   solana --version   # solana-cli 1.18.26 (Agave)
   ```
3. **Anchor CLI**:
   Используйте версию **0.30.1**:
   ```bash
   # 0.30.1 не собирается на Rust ≥ 1.80 с --locked (крейт `time`) — ставим через 1.79:
   rustup toolchain install 1.79.0 --profile minimal
   cargo +1.79.0 install --git https://github.com/coral-xyz/anchor --tag v0.30.1 anchor-cli --locked
   anchor --version # anchor-cli 0.30.1
   ```
4. **Node.js & NPM**:
   ```bash
   node --version # v18.x или v20.x+
   ```
5. **Ключ разработчика**:
   ```bash
   solana-keygen new --no-bip39-passphrase -o ~/.config/solana/id.json -s
   ```
6. **Окружение для Anchor-модулей 11, 12, 14** (PATH, host-toolchain для IDL, `COPYFILE_DISABLE`):
   ```bash
   source tools/env.sh   # при первом запуске установит nightly-2025-04-15 (см. Troubleshooting №4)
   ```

---

## 🚦 Инструкция по сборке и запуску тестов

### 1. Запуск локального тестового валидатора
Для автономной работы без ограничений сторонних кранов запустите локальный валидатор в отдельном окне терминала:
```bash
# macOS: обязательно отключаем копирование расширенных атрибутов
export COPYFILE_DISABLE=1
solana-test-validator --reset --quiet
```
Пополните кошелек тестовыми SOL:
```bash
solana airdrop 100
```

### 2. Запуск Модуля 3 (Rust CLI)
```bash
cd 03_rust_cli_practice
cargo run
```

### 3. Сборка и деплой Модуля 4 (Native Program)
```bash
cd 04_native_program
cargo build-sbf --arch sbfv1
solana program deploy ./target/deploy/native_program.so
```

### 4. Тестирование Модуля 5 (Anchor Counter)
```bash
cd 05_anchor_counter
export COPYFILE_DISABLE=1
anchor test --skip-build
```

### 5. Тестирование Модуля 6 (Anchor PDA Profile)
```bash
cd 06_anchor_pda_profile
export COPYFILE_DISABLE=1
anchor test --skip-build
```

### 6. Запуск Модуля 7 (SPL Tokens)
```bash
cd 07_spl_tokens
npm install
npx tsx scripts/token_flow.ts
```

### 7. Тестирование Модуля 8 (MVP Tip Jar)
```bash
cd 08_mvp_tip_jar
export COPYFILE_DISABLE=1
anchor test --skip-build
```

### 8. Модули 1, 2, 9, 10, 13 (TypeScript)
```bash
(cd 01_first_transaction && npm i && npx tsx scripts/first_tx.ts)       # devnet
(cd 02_transaction_detective && npm i && npm test && npx tsx scripts/detective.ts)
(cd 09_defi_integration && npm i && npm test)                            # + npm run validator / tip_usd.ts
(cd 10_blockchain_dashboard && npm i && npm test && npm run build)
(cd 13_rwa_payments && npm i && npm test)                                # + валидатор / stablecoin.ts
```

### 9. Модули 11, 12, 14 (Anchor) и Demo Day
```bash
source tools/env.sh
for m in 11_cpi_composable 12_security_lab 14_capstone_creator_pay; do (cd $m && npm i && anchor build && anchor test --skip-build); done
(cd 14_capstone_creator_pay/app && npm i && npm test)
./15_demo_day/demo.sh
```

---

## 🏆 Сводная таблица результатов верификации

| Модуль | Статус | Идентификатор программы (Program ID) / Аккаунт | Сигнатура транзакции / Подтверждение |
|---|:---:|---|---|
| **01: First Transaction** | ⏳ **DEVNET PENDING** | Кошелёк `FDgchJxac4Wfv8drcjLzzt63WaLHwBaYUFzxLhHbe1wQ` | Скрипт проверен на localnet (`4aF9AHNi…ZNv93c`). Для сдачи пополнить кошелёк через faucet.solana.com и перезапустить на devnet |
| **02: Tx Detective** | **SUCCESS** | mainnet: Jupiter, Meteora DLMM, Pump.fun | `61ebP9KG…`, `2Zr2NJvX…`, `27weWrBL…` → `reports/` · 7/7 тестов |
| **03: Rust CLI** | **SUCCESS** | Binary: `target/debug/rust_cli_practice` | Invariants Verified (Borsh: 67 bytes, Balance: 6.5 SOL) |
| **04: Native Program** | **SUCCESS** | `BGnG1xneUN1szsMATutNitmDsm8v7741wwhaCVSVzABa` | `fsEWKoWwBinHHmKFtqS8nebVMSCSc2B2J48fjRnPxYHMWHV7U` |
| **05: Anchor Counter** | **SUCCESS** | `HsBg6tbg7bEB8HigAHRnk8k9obB8wZWW5wybNYWQF6v2` | `4y8fij3BNX1kCw998vjRmgAe5PKBcuHPppofYuv9nnK6m88kKzgYb86ipSs1hLv5C5KhxdF1jhgzLpfqY2JBMmjr` |
| **06: PDA Profile** | **SUCCESS** | `AjSnJ9i8gwTYG2oxDHvcV1Xb2w3wLriZSV3iVCTy5YXZ` | User1: `4jKm2sMoNsArHPf4QJkRoD9S1acSn5ybezUGwuykS92wk31nry8jpC7QdFoM6qHWCgYgAmuohaxpZfmnrNqTGgX6`<br>User2: `UWzmQrPSZ8XMgYqnodHry2bGxiDy2AkDtvBXc96FXg9MrwhQV6hHdpAiQHmQu4X8vYQZMKMi44W1qpT2Q8k7TYK` |
| **07: SPL Tokens** | **SUCCESS** | Mint: `CuUxZptservJo8Eq4d3ycfWcFuBR9g7eNNWcZZTBUkEj`<br>Token-2022: `7WheoRf5zPUKaDEfzSAyANNM6itjWHSZG1yPzDKnNdC4` | Mint Tx: `4t9nr5u7kUivzGMHdjSB4PgeaTGg314FohSvzFqGuFmXnfPm74uRxwFo6fLT1vngsiZNdfYCuDEwa7E9AEfMmVsc`<br>Transfer Tx: `nDF4Tyv9ACgXgN5xaJGpzReNoK4VjSkCc2LRX8JTYbNoCGn9dY3u8jtLpRys9fvUjLKfEWWnnGjpUjRhV2UNpg2` |
| **08: MVP Tip Jar** | **SUCCESS** | `E53sP8R8dM68dHLb5FY8oc2ZyNJhBroZPSUCrMewcQNJ` | Jar Init: `4dHuRtmT6yg5iDqPoGcsSadNCTvw1U9TDXgUF7owSTFXtwJHZjJfSaUeDByEnnwiR9PSPTpawmJfZasHPdr2qGpU`<br>Tip Tx: `61P7zhqMP9Nao3A87kdUiZgT4FLVC1YpwyBBQSk3KQ4M8zRZzb1xVS7LskwuErXvmYBiu5ByMw7BWppwG7iJyt2t` |
| **09: DeFi (Pyth + Jupiter)** | **SUCCESS** | tip_jar `E53sP8R8…` (localnet) | $5 = 53 434 624 lamports @ $93.57 (Pyth, Δ Jupiter 0.001 %): `3FtR9Mb17k9abpxkfetFd9Sy95hkjp8BxzMuwdGpF9TG14uts3hQCKCj4iXzFGour7uEPEXEPZJS14otLmAat2SG` · 6/6 тестов |
| **10: Dashboard** | **SUCCESS** | React-приложение + `scripts/snapshot.ts` | 10 tx программы, 5 декодированных событий · 10/10 тестов · build OK · проверено в браузере |
| **11: CPI** | **SUCCESS** | `CQvQzgw8V9rFgAqmBS4E1qNCgQMHe7agWXhkKNwgZs8r` | Reward mint `45bX8Cm3…`, tip+reward: `36Rr7dzKMB13WQ9jH4cVabrFxoD1VGPKiBJ1tpZaFZAmxFHh5pdryvUcj54gpVRTfTBhLqJQ6YJrmGkJLxpV7TPR` · 7/7 тестов |
| **12: Security Lab** | **SUCCESS** | vulnerable `7XjM99vj…` / secure `6igRCJBV…` | 4/4 атак проэксплуатированы на vulnerable и заблокированы на secure · 9/9 тестов |
| **13: RWA / Stablecoin** | **SUCCESS** | tUSD mint `8p5BNdRH2mPusbTiZvjDhEAuoPxCFxc16jFgiLATFfLH` | Оплата инвойса: `3Bd333cLzE9Uo7Pi9JA3xSD4GDB3kYTSm8NBCN5wEPoV6n6LHnD1Eg9H6jXSAtx7rQpK7qwasTz3cGp9gUyKJgix` · KYC-блок и clawback проверены · 5/5 тестов |
| **14: Capstone Creator Pay** | **SUCCESS** | `Fv3WvmspvcUCd7HJ8Kb2NeNvmTXmuEFvF2qVZqBsRQkV` | tip_sol: `2Jphs9zQ…`, tip_stable: `5kfZGsZL…` · 9 интеграционных + 3 Rust + 7 фронтенд-тестов · E2E в браузере |
| **15: Demo Day** | **SUCCESS** | `15_demo_day/demo.sh` | Проверен полный запуск: валидатор → сиды → приложение (HTTP 200), Pyth-прокси (HTTP 200) |

---

## 🛠️ Решенные инженерные нюансы и Troubleshooting

1. **`error: failed to parse lock file ... lock file version 4 requires -Znext-lockfile-bump`**:
   - Причина: системный Cargo (Rust 1.98) генерирует lockfile версии 4, тогда как внутренний компилятор Solana SBF (rustc 1.75) поддерживает только версию 3.
   - Решение: замена на `version = 3` и установка атрибута `chmod 444 Cargo.lock` на время компиляции.
2. **`Error checking to unpack genesis archive: extra entry found: ._genesis.bin`**:
   - Причина: файловая система macOS автоматически упаковывает Apple Double resource fork файлы в архивы `.tar`.
   - Решение: вызов `export COPYFILE_DISABLE=1` перед запуском `solana-test-validator` или тестов Anchor.
3. **`Verifier error: unknown eBPF opcode 0x8c`**:
   - Причина: генерация расширенного байткода SBFv2, не поддерживаемого ранними версиями сред выполнения.
   - Решение: явное указание флага архитектуры `--arch sbfv1` при запуске `cargo build-sbf`.
4. **Конфликт `Span::source_file()` в `anchor-syn`**:
   - Причина: anchor-cli 0.30.1 всегда собирает IDL с `--cfg procmacro2_semver_exempt`, а это требует `proc_macro2::Span::source_file()`. Метод есть только в proc-macro2 ≤ 1.0.94 и только на nightly-компиляторе до весны 2025.
   - Решение для модулей 05–08: ручная сборка `--no-idl` + верифицированный IDL JSON.
   - Решение для модулей 11, 12, 14 (IDL генерируется автоматически): `source tools/env.sh` (host-toolchain `nightly-2025-04-15`) + `cargo update -p proc-macro2 --precise 1.0.94` (функция `anchor_lock_fix`). Сгенерированный IDL для tip_jar совпал с ручным и дополнительно содержит PDA seeds.
5. **Новые зависимости тянут крейты с `edition2024` / `rust-version` > 1.75**:
   - Причина: `cargo update` берёт свежие версии (например, blake3 1.8 → digest 0.11), а platform-tools Solana 1.18 используют rustc/cargo 1.75.
   - Решение: начать с lock-файла модуля 08 и докидывать зависимости MSRV-резолвером: `rust-version = "1.75"` в Cargo.toml программы + `CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo +1.84.1 metadata`.
6. **`anchor-spl` с `default-features = false` + `idl-build` → «could not find `token_interface`»**:
   - Решение: использовать фичи `anchor-spl` по умолчанию (`idl-build` ссылается на `token_interface`).
7. **Devnet `requestAirdrop` → HTTP 410 «The RPC faucet is closed»**:
   - Решение: пополнять кошелёк через https://faucet.solana.com. Для разработки — `SOLANA_RPC_URL=http://127.0.0.1:8899`.
8. **Mainnet: «Transaction version (1) is not supported»**:
   - Причина: на mainnet уже есть v1-сообщения.
   - Решение: `getParsedTransaction(sig, { maxSupportedTransactionVersion: 1 })` (модуль 2).
9. **Pyth Hermes REST → 401; публичный mainnet RPC из браузера → 403**:
   - Решение: цена читается on-chain из `PriceUpdateV2` (модуль 9). В браузере — через Vite-прокси `/mainnet-rpc`, который убирает `Origin` (модуль 14). В проде — `VITE_MAINNET_RPC` с ключом провайдера.
10. **Anchor-события: варианты enum декодируются как `{ Sol: {} }`, поля — в snake_case (`total_tips`)**:
    - Решение: сравнивать вариант без учёта регистра и читать поля по именам из IDL (регрессионные тесты в модулях 10 и 14).
