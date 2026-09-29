/**
 * Prévia do valor de uma linha de efeito: o número que a linha vai de fato
 * somar, multiplicar ou substituir, com as @variáveis já trocadas.
 *
 * Existe para quem escreve "4 * @nvl" ver 60 antes de salvar, e não
 * descobrir no meio do combate que a conta deu outra coisa. A conta é a
 * mesma da aplicação: as mesmas variáveis (ver variaveisDeEfeito) e a mesma
 * regra do Foundry, que só aceita número e aritmética num campo da ficha.
 */
import { PYRO } from "./config.mjs";
import { avaliarConta } from "./regras-efeito.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Categorias que o sistema lê das flags em vez de virar campo da ficha. */
const EM_FLAG = ["condicao", "dano", "multDano", "custo", "alcance"];

const TEM_DADO = /\d*d\d/i;

/** 7, 0,5, 1,33: vírgula decimal, no máximo duas casas. */
export const formatarNumero = n =>
  Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** "+3", "−2" (sinal de menos de verdade, que não some ao lado do número). */
const comSinal = n => (n < 0 ? `−${formatarNumero(-n)}` : `+${formatarNumero(n)}`);

/**
 * Troca as @variáveis conhecidas. Devolve o texto e o que sobrou sem valor,
 * separando as variáveis do card (que só existem no uso) das que não existem
 * em lugar nenhum.
 */
export function trocarVariaveis(texto, vars, doUso = []) {
  const faltando = [];
  const noUso = [];
  const trocado = String(texto).replace(/@([a-z_][\w.]*)/gi, (inteiro, nome) => {
    const valor = foundry.utils.getProperty(vars ?? {}, nome);
    if (valor !== undefined && valor !== null && valor !== "") return String(valor);
    (doUso.includes(nome) ? noUso : faltando).push(nome);
    return inteiro;
  });
  return { trocado, faltando, noUso };
}

/** O texto que a coluna mostra para um número, conforme a linha. */
function rotuloDoNumero(n, { categoria, modo }) {
  if (categoria === "multDano") return `×${formatarNumero(n)}`;
  if (categoria === "alcance") return modo === "multiply" ? `×${formatarNumero(n)}` : `${comSinal(n)} m`;
  if (categoria === "custo") return modo === "multiply" ? `×${formatarNumero(n)}` : comSinal(n);
  if (categoria === "dano") return comSinal(n);
  switch (modo) {
    case "multiply": return `×${formatarNumero(n)}`;
    case "override": return `= ${formatarNumero(n)}`;
    case "upgrade": return `≥ ${formatarNumero(n)}`;
    case "downgrade": return `≤ ${formatarNumero(n)}`;
    default: return comSinal(n);
  }
}

/**
 * A prévia de uma linha do construtor.
 *
 * @param {{categoria: string, alvo: string, modo: string, valor: string}} linha
 * @param {object} contexto
 * @param {object} contexto.varsCampo as variáveis de uma mudança de campo
 *   (atributos sem efeitos, ver getReplacementData).
 * @param {object} contexto.varsUso as variáveis do que o sistema lê na hora
 *   de usar: dano, custo, alcance e multiplicador (atributos em jogo).
 * @param {string[]} [contexto.doUso] variáveis que só existem no card
 *   (@intencao, @danoTotal): sem elas não há número ainda, e isso não é erro.
 * @param {boolean} [contexto.inteiro] o campo alvo só guarda inteiros.
 * @returns {{texto: string, classe: string, dica: string}} classe "erro"
 *   quando a linha não vai valer, "espera" quando depende do uso.
 */
export function previaDaLinha(linha, { varsCampo = {}, varsUso = {}, doUso = [], inteiro = false } = {}) {
  const vazio = { texto: "", classe: "", dica: "" };
  const { categoria, modo } = linha ?? {};
  if (!categoria || categoria === "condicao") return vazio;
  const escrito = String(linha.valor ?? "").trim();
  if (!escrito) return vazio;
  const vars = EM_FLAG.includes(categoria) ? varsUso : varsCampo;

  const { trocado, faltando, noUso } = trocarVariaveis(escrito, vars, doUso);
  if (faltando.length) {
    return {
      texto: `@${faltando[0]}?`, classe: "erro",
      dica: loc("PYRO.Efeitos.Previa.SemVariavel", { nome: `@${faltando.join(", @")}` })
    };
  }
  if (noUso.length) {
    return {
      texto: loc("PYRO.Efeitos.Previa.NoUso"), classe: "espera",
      dica: loc("PYRO.Efeitos.Previa.NoUsoDica", { nome: `@${noUso.join(", @")}`, conta: trocado })
    };
  }

  // Dano é rolagem: dado continua dado, só as variáveis viram número.
  if (categoria === "dano" && TEM_DADO.test(trocado)) {
    const valido = globalThis.Roll?.validate ? Roll.validate(trocado) : true;
    return valido
      ? { texto: trocado.replace(/\s+/g, " "), classe: "", dica: `${escrito} → ${trocado}` }
      : { texto: "?", classe: "erro", dica: loc("PYRO.Efeitos.Previa.Invalida") };
  }

  const n = avaliarConta(trocado);
  if (!Number.isFinite(n)) {
    return {
      texto: "?", classe: "erro",
      dica: loc(TEM_DADO.test(trocado) ? "PYRO.Efeitos.Previa.SemDado" : "PYRO.Efeitos.Previa.Invalida")
    };
  }
  const conta = trocado.trim() === formatarNumero(n) || trocado.trim() === String(n)
    ? "" : `${trocado.trim()} = ${formatarNumero(n)}`;
  const avisos = [conta];
  // Campo inteiro com conta quebrada: o sistema arredonda para baixo.
  if (inteiro && !EM_FLAG.includes(categoria) && (modo === "multiply" || !Number.isInteger(n))) {
    avisos.push(loc("PYRO.Efeitos.Previa.Inteiro"));
  }
  return { texto: rotuloDoNumero(n, { categoria, modo }), classe: "", dica: avisos.filter(Boolean).join(" ") };
}

/**
 * O campo que a linha altera só guarda inteiros? Pergunta ao modelo de dados
 * do ator. Sem ator (item solto no mundo), pergunta ao do personagem.
 */
export function campoInteiro(actor, chave) {
  if (!String(chave ?? "").startsWith("system.")) return false;
  const modelo = actor?.system?.constructor ?? CONFIG.Actor?.dataModels?.personagem;
  const campo = modelo?.schema?.getField?.(chave.slice(7));
  return !!campo?.integer;
}

/** Os atributos na ordem da ficha, para os botões de variável. */
export const chavesDeAtributo = () => Object.keys(PYRO.atributos);
