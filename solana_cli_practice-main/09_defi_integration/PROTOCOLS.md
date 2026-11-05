# 🏦 DeFi на Solana — обзор протоколов и выбор для Tip Jar

> Неделя 9. Задание: изучить реальные протоколы экосистемы и встроить DeFi-функциональность в приложение.
> Код: [`src/defi.ts`](src/defi.ts) · [`scripts/prices.ts`](scripts/prices.ts) · [`scripts/tip_usd.ts`](scripts/tip_usd.ts)

## 1. Карта экосистемы

| Категория | Протокол | Program ID | Что делает | Как видно on-chain (модуль 2) |
|---|---|---|---|---|
| Агрегатор | **Jupiter v6** | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | Ищет лучший маршрут обмена через десятки AMM, делит ордер между пулами | 1 top-level инструкция → десятки inner CPI в AMM и Token-программы |
| AMM (constant product) | **Raydium AMM v4 / CPMM** | `675kPX9M…`, `CPMMoo8L…` | Пулы `x·y=k`, листинг новых токенов | CPI `transfer` × 2 (вход/выход) |
| AMM (concentrated) | **Orca Whirlpool**, **Raydium CLMM** | `whirLbMi…`, `CAMMCzo5…` | Ликвидность в ценовых диапазонах (как Uniswap v3) — меньше проскальзывание | tick-array аккаунты в списке accounts |
| AMM (bins) | **Meteora DLMM** | `LBUZKhRx…` | Ликвидность в дискретных «бинах», динамические комиссии | видно в отчёте `reports/2Zr2…md` |
| Лаунчпад | **Pump.fun / PumpSwap** | `6EF8rrec…`, `pAMMBay6…` | Bonding curve → миграция в AMM | отчёт `reports/27we…md` |
| Оракул | **Pyth** (Solana Receiver) | `rec5EKMG…` | Цены от маркет-мейкеров и бирж; push-аккаунты `PriceUpdateV2` с ценой, confidence и временем | аккаунт `7UVimffx…` (SOL/USD) |
| Лендинг | **Kamino Lend** | `KLend2g3…` | Займы под залог, ликвидации по ценам оракулов | — |
| Liquid staking | **Marinade** | `MarBmsSg…` | SOL → mSOL, доходность стейкинга остаётся ликвидной | — |

**Наблюдение из живых данных** (`npx tsx scripts/prices.ts`, ноябрь 2026): маршрут SOL→USDC Jupiter для 1 SOL шёл через **один** пул (GoonFi V2 / TesseraV). Для 100 SOL он делился между 3 площадками, для 10 000 SOL — между 4. Price impact рос с 0 % до ~0,05 %. Так на практике выглядит работа агрегатора.

## 2. Что нужно Tip Jar и почему

Проблема модуля 8: чаевые задаются в lamports, а люди думают в долларах. «Задонатить $5» требует **надёжной цены SOL/USD** в момент платежа.

| Вариант | Плюсы | Минусы | Решение |
|---|---|---|---|
| Pyth Hermes REST | просто | теперь требует API-ключ (HTTP 401), off-chain | ❌ |
| **Pyth on-chain `PriceUpdateV2`** | данные уже в блокчейне, проверяемы, есть confidence и время | нужен ручной декодер (или Anchor SDK) | ✅ основной источник |
| **Jupiter quote** | «рыночная» цена с учётом реальной ликвидности | это котировка, а не оракул; зависит от маршрута | ✅ кросс-проверка |
| Цена из одного AMM-пула | легко прочитать резервы | манипулируется флэш-сделками | ❌ |

## 3. Реализованная интеграция

```text
Pyth PriceUpdateV2 (mainnet) ──► проверка: feed id · Full verification · age ≤ 120 с · conf/price ≤ 1 %
                                   │
Jupiter quote 1 SOL → USDC ───────►├─► |market − oracle| / oracle ≤ 2 %  (иначе отказ)
                                   │
$X → lamports = ⌊cents·10⁹·10^(−exp) / (price·100)⌋   (целочисленно, вниз)
                                   │
lamports ≤ market_lamports · (1 + 1 %)  (потолок проскальзывания)
                                   ▼
tip_jar.tip(lamports, "$5.00 tip @ $93.57/SOL (Pyth)")  → автор получает ровно рассчитанную сумму
```

**Риски и как они закрыты:**
- **Устаревшая цена:** проверка `publish_time`.
- **Неуверенный рынок:** проверка `conf/price`.
- **Подмена аккаунта оракула:** проверка `owner == Pyth Receiver` и `feed_id`.
- **Расхождение источников:** сверка с Jupiter.
- **Ошибки плавающей точки:** вся арифметика в `bigint`.

## 4. Куда развивать (использовано в Capstone, неделя 14)

- Перенести проверку цены **в программу**: передавать `PriceUpdateV2` как аккаунт и проверять его через `pyth-solana-receiver-sdk`, принимать `usd_cents` и `max_lamports`.
- Принимать чаевые в стейблкоине — сделано в Creator Pay (`tip_stable`, Token-2022 tUSD).
- Автоконвертация: Jupiter swap SOL→USDC в той же транзакции для авторов, которым нужны доллары.
