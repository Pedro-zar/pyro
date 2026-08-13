import { PYRO } from "./config.mjs";

/**
 * Converte um valor de atributo na pool da Tabela de Dados.
 * Retorna { n, faces } — faces 0 representa o valor fixo "1" (atributo 1).
 * AJUSTE: a tabela vai até 50; acima disso o valor é grampeado em 50
 * até o SRD definir a extensão.
 */
export function poolDoAtributo(valor) {
  const v = Math.clamp(Math.round(valor), 1, 50);
  const formula = PYRO.tabelaDados[v];
  if (formula === "1") return { n: 1, faces: 0 };
  const [n, faces] = formula.split("d").map(Number);
  return { n, faces };
}

/**
 * Monta a fórmula final de um teste de atributo.
 * Vantagem soma dados na pool, desvantagem remove (SRD §6).
 * Retorna null se a pool cair a 0 dados (falha automática).
 */
export function formulaTeste(valor, { vantagem = 0, desvantagem = 0, bonus = 0 } = {}) {
  const pool = poolDoAtributo(valor);
  if (pool.faces === 0) {
    // Atributo 1: valor fixo. Vantagem/desvantagem não se aplicam a um dado fixo.
    return bonus ? `1 + ${bonus}` : "1";
  }
  const n = pool.n + vantagem - desvantagem;
  if (n <= 0) return null;
  let formula = `${n}d${pool.faces}`;
  if (bonus) formula += ` + ${bonus}`;
  return formula;
}

/**
 * Atalho de escrita nas fórmulas: [VIG], [FOR]... viram @vig, @for — o MOD
 * (valor efetivo) do atributo entra na conta via getRollData.
 */
export function expandirAtributos(formula) {
  return String(formula ?? "").replace(/\[(FOR|VIG|DES|AGI|INT|SAB|PRE)\]/gi,
    (m, sigla) => `@${sigla.toLowerCase()}`);
}

/** Fórmula "crua" da pool (sem ajustes) — usada em @dados.* e na iniciativa. */
export function formulaPool(valor) {
  const pool = poolDoAtributo(valor);
  return pool.faces === 0 ? "1" : `${pool.n}d${pool.faces}`;
}
