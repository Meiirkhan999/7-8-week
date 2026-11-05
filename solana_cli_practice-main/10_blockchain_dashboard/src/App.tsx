import { useCallback, useEffect, useMemo, useState } from "react";
import { Connection, PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import ActivityChart from "./ActivityChart";
import {
  CLUSTERS,
  LAMPORTS_PER_SOL,
  type WalletOverview,
  bucketSignatures,
  explorerUrl,
  fetchProgramActivity,
  fetchWalletOverview,
  pickBucketSeconds,
  shorten,
  successRate,
} from "./lib/solana";
import { type DecodedEvent, TIP_JAR_PROGRAM_ID, fetchRecentEvents } from "./lib/events";

type Status = "idle" | "loading" | "ready" | "error";

function readParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    cluster: p.get("cluster") ?? "localnet",
    rpc: p.get("rpc") ?? "",
    address: p.get("address") ?? "",
    program: p.get("program") ?? TIP_JAR_PROGRAM_ID.toBase58(),
  };
}

function parseKey(v: string): PublicKey | null {
  try {
    return v.trim() ? new PublicKey(v.trim()) : null;
  } catch {
    return null;
  }
}

const fmtTime = (t: number | null | undefined) => (t ? new Date(t * 1000).toLocaleString() : "—");
const fmtNum = (n: number, max = 4) =>
  Math.abs(n) >= 1e6
    ? n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 })
    : n.toLocaleString(undefined, { maximumFractionDigits: max });

export default function App() {
  const initial = useMemo(readParams, []);
  const [cluster, setCluster] = useState(initial.cluster);
  const [customRpc, setCustomRpc] = useState(initial.rpc);
  const [address, setAddress] = useState(initial.address);
  const [program, setProgram] = useState(initial.program);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [wallet, setWallet] = useState<WalletOverview | null>(null);
  const [programSigs, setProgramSigs] = useState<ConfirmedSignatureInfo[]>([]);
  const [events, setEvents] = useState<DecodedEvent[]>([]);

  const rpcUrl = cluster === "custom" ? customRpc : CLUSTERS[cluster];

  const load = useCallback(async () => {
    const addr = parseKey(address);
    const prog = parseKey(program);
    if (address.trim() && !addr) return (setStatus("error"), setError("Адрес кошелька не является валидным base58 public key"));
    if (program.trim() && !prog) return (setStatus("error"), setError("Program ID не является валидным base58 public key"));
    if (!addr && !prog) return (setStatus("error"), setError("Укажите адрес кошелька и/или Program ID"));

    const params = new URLSearchParams({ cluster, address: address.trim(), program: program.trim() });
    if (cluster === "custom") params.set("rpc", customRpc);
    window.history.replaceState(null, "", `?${params}`);

    setStatus("loading");
    setError("");
    try {
      const connection = new Connection(rpcUrl, "confirmed");
      const [w, sigs] = await Promise.all([
        addr ? fetchWalletOverview(connection, addr) : Promise.resolve(null),
        prog ? fetchProgramActivity(connection, prog) : Promise.resolve([]),
      ]);
      setWallet(w);
      setProgramSigs(sigs);
      setEvents(prog?.equals(TIP_JAR_PROGRAM_ID) ? await fetchRecentEvents(connection, sigs.map((s) => s.signature)) : []);
      setStatus("ready");
    } catch (e: any) {
      setStatus("error");
      setError(`RPC ${rpcUrl}: ${e?.message ?? e}`);
    }
  }, [address, program, cluster, customRpc, rpcUrl]);

  useEffect(() => {
    if (initial.address || initial.program) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bucketSeconds = pickBucketSeconds(programSigs);
  const buckets = bucketSignatures(programSigs, bucketSeconds);
  const link = (kind: "tx" | "address", v: string) => explorerUrl(kind, v, cluster, rpcUrl);

  return (
    <div className="page">
      <header>
        <h1>Solana Dashboard</h1>
        <p className="muted">Балансы, токены, транзакции и активность программ — напрямую через JSON-RPC.</p>
      </header>

      <form
        className="controls"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          Кластер
          <select value={cluster} onChange={(e) => setCluster(e.target.value)}>
            {Object.keys(CLUSTERS).map((c) => (
              <option key={c}>{c}</option>
            ))}
            <option value="custom">custom RPC</option>
          </select>
        </label>
        {cluster === "custom" && (
          <label className="grow">
            RPC URL
            <input value={customRpc} onChange={(e) => setCustomRpc(e.target.value)} placeholder="https://..." />
          </label>
        )}
        <label className="grow">
          Кошелёк
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Адрес (base58)" spellCheck={false} />
        </label>
        <label className="grow">
          Program ID
          <input value={program} onChange={(e) => setProgram(e.target.value)} placeholder="Program ID (base58)" spellCheck={false} />
        </label>
        <button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Загрузка…" : "Загрузить"}
        </button>
      </form>

      {status === "error" && <div className="error" role="alert">{error}</div>}

      {status === "ready" && (
        <>
          <section className="tiles">
            {wallet && (
              <>
                <div className="tile">
                  <span className="tile-label">Баланс SOL</span>
                  <span className="tile-value">{fmtNum(wallet.lamports / LAMPORTS_PER_SOL)}</span>
                  <span className="muted small">{wallet.executable ? "исполняемый аккаунт (программа)" : `owner ${shorten(wallet.owner ?? "—")}`}</span>
                </div>
                <div className="tile">
                  <span className="tile-label">Токены</span>
                  <span className="tile-value">{wallet.holdings.length}</span>
                  <span className="muted small">
                    {wallet.holdings.filter((h) => h.program === "Token-2022").length} из них Token-2022
                  </span>
                </div>
                <div className="tile">
                  <span className="tile-label">Транзакции кошелька</span>
                  <span className="tile-value">{wallet.signatures.length}</span>
                  <span className="muted small">последние, успешных {Math.round(successRate(wallet.signatures) * 100)}%</span>
                </div>
              </>
            )}
            {programSigs.length > 0 && (
              <div className="tile">
                <span className="tile-label">Вызовы программы</span>
                <span className="tile-value">{programSigs.length}</span>
                <span className="muted small">последние, успешных {Math.round(successRate(programSigs) * 100)}%</span>
              </div>
            )}
          </section>

          {wallet && (
            <div className="grid2">
              <section className="panel">
                <h2>Токены</h2>
                {wallet.holdings.length === 0 ? (
                  <p className="muted">Нет токенов с ненулевым балансом.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Mint</th>
                        <th>Стандарт</th>
                        <th className="num">Баланс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wallet.holdings.map((h) => (
                        <tr key={h.account}>
                          <td>
                            <a href={link("address", h.mint)} target="_blank" rel="noreferrer" className="mono">
                              {shorten(h.mint, 6)}
                            </a>
                          </td>
                          <td>{h.program}</td>
                          <td className="num">{fmtNum(h.amount, h.decimals)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="panel">
                <h2>Последние транзакции</h2>
                {wallet.signatures.length === 0 ? (
                  <p className="muted">Транзакций нет.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Signature</th>
                        <th>Время</th>
                        <th>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wallet.signatures.slice(0, 15).map((s) => (
                        <tr key={s.signature}>
                          <td>
                            <a href={link("tx", s.signature)} target="_blank" rel="noreferrer" className="mono">
                              {shorten(s.signature, 6)}
                            </a>
                          </td>
                          <td>{fmtTime(s.blockTime)}</td>
                          <td>{s.err ? <span className="badge bad">✕ ошибка</span> : <span className="badge ok">✓ успех</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          )}

          {parseKey(program) && (
            <section className="panel">
              <h2>
                Активность программы{" "}
                <a href={link("address", program.trim())} target="_blank" rel="noreferrer" className="mono small">
                  {shorten(program.trim(), 6)}
                </a>
              </h2>
              <p className="muted small">Транзакции во времени (последние {programSigs.length})</p>
              <ActivityChart buckets={buckets} bucketSeconds={bucketSeconds} />
            </section>
          )}

          {events.length > 0 && (
            <section className="panel">
              <h2>События Tip Jar (Anchor events)</h2>
              <table>
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Событие</th>
                    <th className="num">Сумма, SOL</th>
                    <th>Сообщение</th>
                    <th>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e, i) => (
                    <tr key={`${e.signature}-${i}`}>
                      <td>{fmtTime(e.blockTime)}</td>
                      <td>{e.name}</td>
                      <td className="num">{e.data.amount ? fmtNum(Number(e.data.amount) / LAMPORTS_PER_SOL, 6) : "—"}</td>
                      <td>{e.data.message ?? ""}</td>
                      <td>
                        <a href={link("tx", e.signature)} target="_blank" rel="noreferrer" className="mono">
                          {shorten(e.signature)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
