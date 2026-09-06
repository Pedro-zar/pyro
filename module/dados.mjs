import { PYRO } from "./config.mjs";

/**
 * Converte um valor de atributo na pool da Tabela de Dados (SRD Atributos).
 * A tabela termina em 50; acima disso vale a última linha.
 * @returns {{n: number, faces: number}} faces 0 é o valor fixo "1" do atributo 1.
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
  // "+ -2" rola, mas ninguém escreve assim: o sinal entra no operador.
  const comBonus = base => (!bonus ? base
    : bonus > 0 ? `${base} + ${bonus}` : `${base} - ${-bonus}`);
  const pool = poolDoAtributo(valor);
  if (pool.faces === 0) {
    // Atributo 1: valor fixo. Vantagem/desvantagem não se aplicam a um dado fixo.
    return comBonus("1");
  }
  const n = pool.n + vantagem - desvantagem;
  if (n <= 0) return null;
  return comBonus(`${n}d${pool.faces}`);
}

/**
 * Fórmula final de uma reação (esquiva ou bloqueio) a partir da fórmula da
 * ficha ("4d12 + 2d4"). Vantagem soma dados do dado da reação (d12 na
 * esquiva, d4 no bloqueio) e desvantagem tira; a cobertura dobra todos os
 * dados; o bônus fixo entra no fim. Sem dado nenhum sobrando, null: falha
 * automática, a mesma regra da pool zerada nos testes de atributo.
 */
export function formulaReacao(formula, faces, { vantagem = 0, desvantagem = 0, bonus = 0, cobertura = false } = {}) {
  const termo = new RegExp(`(^|\\s)(\\d+)d${faces}(?!\\d)`);
  let f = juntarDados([formula]);
  const m = termo.exec(f);
  const atual = m ? Number(m[2]) : 0;
  const novo = atual + vantagem - desvantagem;
  if (m) f = f.replace(termo, novo > 0 ? `$1${novo}d${faces}` : "$1").trim();
  else if (novo > 0) f = juntarDados([`${novo}d${faces}`, f]);
  // Tirar o termo do meio pode deixar "+ 2d4" ou "2d12 + " para trás.
  f = juntarDados([f]);
  if (!/\dd\d/.test(f)) return null;
  if (cobertura) f = f.replace(/(\d+)d(\d+)/g, (x, n, fc) => `${Number(n) * 2}d${fc}`);
  bonus = Number(bonus) || 0;
  return !bonus ? f : bonus > 0 ? `${f} + ${bonus}` : `${f} - ${-bonus}`;
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

/**
 * Junta várias fórmulas numa só, somando os dados de mesmas faces.
 *
 * Um bloqueio com escudo e brincos virava "2d4 + 2d4 + 2d4" no botão, e com
 * mais uma peça não cabia mais na ficha. A rolagem é a mesma, então o que
 * aparece é o total: "6d4". Dados de faces diferentes continuam separados,
 * porque 1d4 e 1d12 não viram um dado só, e o que não for dado nem número
 * ([FOR], @sab) passa intacto para o Roll resolver.
 */
export function juntarDados(partes) {
  const porFaces = new Map();
  const soltos = [];
  let fixo = 0;

  for (const parte of partes) {
    if (!parte) continue;
    // Separa os sinais dos termos: "2d4-1" vira ["2d4", "-", "1"].
    const termos = String(parte).replace(/([+-])/g, " $1 ").split(/\s+/).filter(Boolean);
    let sinal = 1;
    for (const termo of termos) {
      if (termo === "+" || termo === "-") { sinal = termo === "+" ? 1 : -1; continue; }
      const dado = /^(\d*)d(\d+)$/i.exec(termo);
      if (dado) {
        const faces = Number(dado[2]);
        const n = dado[1] === "" ? 1 : Number(dado[1]);
        porFaces.set(faces, (porFaces.get(faces) ?? 0) + sinal * n);
      }
      else if (/^\d+$/.test(termo)) fixo += sinal * Number(termo);
      else soltos.push(sinal < 0 ? `-${termo}` : termo);
      sinal = 1;
    }
  }

  // Dados maiores primeiro: "2d12 + 1d4" lê melhor que o contrário.
  const pedacos = [...porFaces.entries()]
    .sort(([a], [b]) => b - a)
    .filter(([, n]) => n !== 0)
    .map(([faces, n]) => (n > 0 ? `${n}d${faces}` : `-${-n}d${faces}`));
  pedacos.push(...soltos);
  if (fixo) pedacos.push(String(fixo));

  return pedacos.reduce((texto, p) => {
    if (!texto) return p;
    return p.startsWith("-") ? `${texto} - ${p.slice(1)}` : `${texto} + ${p}`;
  }, "");
}
